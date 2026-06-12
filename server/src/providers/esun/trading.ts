// server/src/providers/esun/trading.ts — 玉山證券 (@esun/trade) trading.
//
// The SDK is the fugle-trade lineage (async Promise API), so unlike the
// fubon/nova providers every SDK call here is awaited. Implementation
// notes:
//   - login is config-driven; we always pass a full config object
//     (apiUrl/apiKey/apiSecret/certPath/certPass/aid/password) so the
//     keytar/inquirer interactive path never runs
//   - NEVER call sdk.logout() — it deletes the stored keyring credentials
//     used by other esun tools on this machine; dispose only disconnects
//     the streamer
//   - order reports arrive on streamer events 'order' (ACK) and 'trade'
//     (MAT) after streamer.connect()
//   - market data comes from the separate @esun/marketdata package, same
//     config, fugle-shaped REST/WS clients (rate limits: 600/min intraday)
//
// 玉山 supports STOCKS ONLY — capabilities().futures === false.

import { randomUUID } from 'node:crypto';
import type {
    Account,
    AccountBalance,
    AccountTypeName,
    Action,
    FuturesOrderReq,
    Margin,
    OrderEventData,
    PnlRow,
    Position,
    StockOrderReq,
    Trade,
} from '../../types/dto.ts';
import type { Config } from '../../config.ts';
import type { ContractKey, MarketClientSource } from '../market-data.ts';
import {
    FuturesNotSupportedError,
    TradeNotFoundError,
    zeroMargin,
    type TradingProvider,
} from '../trading.ts';
import {
    deriveStatus,
    isErrCode,
    isShareLot,
    mapStockOrder,
    num,
    type EsunConfig,
    type EsunMarketdataClient,
    type EsunPlacedOrder,
    type EsunPlacedOrderPayload,
    type EsunSdk,
} from './map.ts';

export class EsunTradingProvider implements TradingProvider {
    private sdk!: EsunSdk;
    private mdMod: { EsunMarketdata: new (o: unknown) => EsunMarketdataClient } | null =
        null;
    private md: EsunMarketdataClient | null = null;
    private esunConfig!: EsunConfig;
    private eventCbs: ((ev: OrderEventData) => void)[] = [];
    private refs = new Map<string, { ordNo: string; trade: Trade }>();
    private idByOrdNo = new Map<string, string>();
    private cache = new Map<string, { at: number; value: unknown }>();

    constructor(private config: Config) {}

    /**
     * 玉山帳務 API 速率限制嚴格（AGR0003/AGR0005，超限要等 1 分鐘）—
     * 前端 10 秒輪詢必須走快取；限流時回上一次的結果而不是報錯。
     */
    private async cached<T>(
        key: string,
        ttlMs: number,
        fn: () => Promise<T>,
    ): Promise<T> {
        const hit = this.cache.get(key);
        if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
        try {
            const value = await fn();
            this.cache.set(key, { at: Date.now(), value });
            return value;
        } catch (err) {
            if (hit) return hit.value as T; // rate-limited — serve stale
            throw err;
        }
    }

    capabilities() {
        return { futures: false, condition_orders: false };
    }

    async init(): Promise<void> {
        const { idNo, password, apiKey, apiSecret, certPath, certPass, apiUrl } =
            this.config.broker;
        if (!idNo || !password || !certPath || !apiKey || !apiSecret) {
            throw new Error(
                'TRADE_PROVIDER=esun 需要 帳號(BROKER_ID_NO) / BROKER_PASSWORD / ' +
                    'BROKER_API_KEY / BROKER_API_SECRET / BROKER_CERT_PATH / BROKER_CERT_PASS',
            );
        }
        let mod: { EsunTrade: new (o: unknown) => EsunSdk };
        try {
            mod = await import('@esun/trade' as string);
        } catch {
            throw new Error(
                '找不到 @esun/trade — 請將 esun-trade-<version>.tgz 放入 server/vendor/ 並執行 ' +
                    'pnpm --filter nova-pro-server add file:vendor/esun-trade-<version>.tgz',
            );
        }
        try {
            this.mdMod = await import('@esun/marketdata' as string);
        } catch {
            this.mdMod = null; // trading still works; market follow degrades
        }
        this.esunConfig = {
            apiUrl: apiUrl || 'https://esuntradingapi.esunsec.com.tw/api/v1',
            apiKey,
            apiSecret,
            certPath,
            certPass,
            aid: idNo,
            password,
        };
        this.sdk = new mod.EsunTrade({ config: this.esunConfig });
        await this.sdk.login();

        this.sdk.streamer.on('order', (msg) => this.emitAck(msg));
        this.sdk.streamer.on('trade', (msg) => this.emitFill(msg));
        this.sdk.streamer.on('error', () => undefined);
        this.sdk.streamer.connect();
        console.log(`esun: 登入成功 ${idNo}`);
    }

    dispose(): void {
        // no sdk.logout(): it wipes the keyring credentials shared with
        // other esun tools — just drop the streamer connection
        try {
            this.sdk?.streamer?.disconnect();
        } catch {
            // already closed
        }
    }

    /**
     * 玉山自帶行情（@esun/marketdata，與富果同形狀）。clients 需先
     * login() 取得 sdkToken — makeWs 重新 login 換新 token。
     * 行情上限：盤中 600 req/min。
     */
    marketdataSource(): MarketClientSource | null {
        if (!this.mdMod) return null;
        const make = async (): Promise<EsunMarketdataClient> => {
            const md = new this.mdMod!.EsunMarketdata({
                config: this.esunConfig,
            });
            await md.login();
            return md;
        };
        return {
            makeRest: async () => {
                if (!this.md) this.md = await make();
                return this.md.restClient;
            },
            makeWs: async () => {
                this.md = await make(); // fresh token for (re)connects
                return this.md.websocketClient;
            },
        };
    }

    private emit(ev: OrderEventData): void {
        for (const cb of this.eventCbs) cb(ev);
    }

    private emitAck(msg: Record<string, unknown>): void {
        const p = msg as EsunPlacedOrderPayload;
        const ordNo = String(p.ordNo ?? '');
        const cel = num(p.celQty);
        this.emit({
            operation: {
                op_type: cel > 0 ? 'Cancel' : 'New',
                op_code: isErrCode(p.errCode) ? p.errCode! : '00',
                op_msg: String(p.errMsg ?? ''),
            },
            order: {
                id: this.idByOrdNo.get(ordNo),
                seqno: '',
                ordno: ordNo,
                action: (p.buySell === 'S' ? 'Sell' : 'Buy') as Action,
                price: num(p.odPrice),
                quantity: num(p.orgQty),
            },
            contract: { code: String(p.stockNo ?? '') },
            status: {},
        });
    }

    private emitFill(msg: Record<string, unknown>): void {
        const ordNo = String(msg.ordNo ?? '');
        const id = this.idByOrdNo.get(ordNo);
        const price = num(
            (msg.matPrice ?? msg.price ?? msg.avgPrice) as string | number,
        );
        const quantity = num((msg.matQty ?? msg.qty) as string | number);
        const action = (msg.buySell === 'S' ? 'Sell' : 'Buy') as Action;
        const code = String(msg.stockNo ?? '');
        this.emit({
            operation: { op_type: 'Deal', op_code: '00', op_msg: '' },
            order: { id, seqno: '', ordno: ordNo, action, price, quantity },
            contract: { code },
            status: {},
            code,
            price,
            quantity,
            action,
        });
    }

    onOrderEvent(cb: (ev: OrderEventData) => void): void {
        this.eventCbs.push(cb);
    }

    async accounts(): Promise<Account[]> {
        return [
            {
                account_type: 'S',
                person_id: '',
                broker_id: 'ESUN',
                account_id: this.config.broker.idNo,
                signed: true,
                username: '',
            },
        ];
    }

    /** deterministic id — survives server restarts (see nova provider) */
    private tradeId(ordNo: string): string {
        let id = this.idByOrdNo.get(ordNo);
        if (!id) {
            id = ordNo ? `esun-${ordNo}` : randomUUID();
            this.idByOrdNo.set(ordNo, id);
        }
        return id;
    }

    private payloadToTrade(p: EsunPlacedOrderPayload): Trade {
        const ordNo = String(p.ordNo ?? '');
        const id = this.tradeId(ordNo);
        const shareLot = isShareLot(p.apCode);
        // orgQty is 張 for Common, but odd lots carry shares in *Share
        const qty = shareLot ? num(p.orgQtyShare ?? p.orgQty) : num(p.orgQty);
        const filled = shareLot
            ? num(p.matQtyShare ?? p.matQty)
            : num(p.matQty);
        const cancelled = shareLot
            ? num(p.celQtyShare ?? p.celQty)
            : num(p.celQty);
        const trade: Trade = {
            contract: {
                exchange: 'TSE',
                code: String(p.stockNo ?? ''),
                security_type: 'STK',
                target_code: null,
            },
            order: {
                id,
                seqno: '',
                ordno: ordNo,
                action: (p.buySell === 'S' ? 'Sell' : 'Buy') as Action,
                price: num(p.odPrice),
                quantity: qty,
                order_type:
                    p.bsFlag === 'I' ? 'IOC' : p.bsFlag === 'F' ? 'FOK' : 'ROD',
                price_type: p.priceFlag === '4' ? 'MKT' : 'LMT',
                order_lot:
                    p.apCode === '5'
                        ? 'IntradayOdd'
                        : p.apCode === '3'
                          ? 'Odd'
                          : p.apCode === '2'
                            ? 'Fixing'
                            : 'Common',
            },
            status: {
                id,
                status: deriveStatus(p),
                status_code: isErrCode(p.errCode) ? p.errCode! : '00',
                order_quantity: qty,
                deal_quantity: filled,
                cancel_quantity: cancelled,
                modified_price: 0,
                msg: String(p.errMsg ?? ''),
                deals: [],
            },
        };
        this.refs.set(id, { ordNo, trade });
        return trade;
    }

    async placeStockOrder(
        key: ContractKey,
        order: StockOrderReq,
    ): Promise<Trade> {
        const mod = (await import('@esun/trade' as string)) as {
            Order: new (p: unknown) => unknown;
        };
        const res = await this.sdk.placeOrder(
            new mod.Order(mapStockOrder(key.code, order)),
        );
        this.cache.delete('orders'); // 委託列表立即重抓
        if (isErrCode(res.retCode)) {
            throw new Error(`下單失敗: ${res.retMsg ?? res.retCode}`);
        }
        const id = this.tradeId(res.ordNo);
        const trade: Trade = {
            contract: {
                exchange: (key.exchange ??
                    'TSE') as Trade['contract']['exchange'],
                code: key.code,
                security_type: key.security_type,
                target_code: null,
            },
            order: {
                id,
                seqno: '',
                ordno: res.ordNo,
                action: order.action,
                price: order.price,
                quantity: order.quantity,
                order_type: order.order_type,
                price_type: order.price_type,
                order_lot: order.order_lot ?? 'Common',
            },
            status: {
                id,
                status: 'Submitted',
                status_code: '00',
                order_ts: Date.now(),
                order_quantity: order.quantity,
                deal_quantity: 0,
                cancel_quantity: 0,
                modified_price: 0,
                msg: '',
                deals: [],
            },
        };
        this.refs.set(id, { ordNo: res.ordNo, trade });
        return trade;
    }

    async placeFuturesOrder(
        _key: ContractKey,
        _order: FuturesOrderReq,
    ): Promise<Trade> {
        throw new FuturesNotSupportedError();
    }

    private getOrdersCached(): Promise<EsunPlacedOrder[]> {
        return this.cached('orders', 20_000, () => this.sdk.getOrders());
    }

    /** modify/cancel take the live PlacedOrder — re-query by 委託書號 */
    private async freshOrder(tradeId: string): Promise<EsunPlacedOrder> {
        let ref = this.refs.get(tradeId);
        if (!ref && tradeId.startsWith('esun-')) {
            // server restarted since the UI fetched this id
            ref = { ordNo: tradeId.slice(5), trade: undefined as never };
        }
        if (!ref) throw new TradeNotFoundError(tradeId);
        const orders = await this.getOrdersCached();
        const found = orders.find(
            (o) => String(o.payload.ordNo ?? '') === ref.ordNo,
        );
        if (!found) throw new TradeNotFoundError(tradeId);
        return found;
    }

    async cancel(tradeId: string): Promise<Trade> {
        const placed = await this.freshOrder(tradeId);
        await this.sdk.cancelOrder(placed);
        this.cache.delete('orders');
        const trade = this.payloadToTrade(placed.payload);
        trade.status.status = 'Cancelled';
        return trade;
    }

    async updatePrice(tradeId: string, price: number): Promise<Trade> {
        const placed = await this.freshOrder(tradeId);
        await this.sdk.replacePrice(placed, price);
        this.cache.delete('orders');
        const trade = this.payloadToTrade(placed.payload);
        trade.order.price = price;
        trade.status.modified_price = price;
        return trade;
    }

    async updateQty(tradeId: string, quantity: number): Promise<Trade> {
        const placed = await this.freshOrder(tradeId);
        // replaceQuantity 是「改後總量」語意（fugle-trade 慣例）；單位同
        // 下單（張/股 依盤別）
        await this.sdk.replaceQuantity(placed, quantity);
        this.cache.delete('orders');
        const trade = this.payloadToTrade(placed.payload);
        trade.order.quantity = quantity;
        trade.status.order_quantity = quantity;
        return trade;
    }

    async trades(accountType: AccountTypeName): Promise<Trade[]> {
        if (accountType !== 'S') return [];
        const orders = await this.getOrdersCached();
        return orders.map((o) => this.payloadToTrade(o.payload));
    }

    async positions(accountType: AccountTypeName): Promise<Position[]> {
        if (accountType !== 'S') return [];
        const rows = await this.cached('inventories', 30_000, () =>
            this.sdk.getInventories(),
        );
        return rows.map((row, i) => ({
            id: i,
            code: String(row.stkNo ?? ''),
            direction: 'Buy' as Action,
            quantity: num(row.costQty) / 1000,
            price: num(row.priceAvg),
            last_price: num(row.priceNow),
            pnl: num(row.makeASum),
            yd_quantity: num(row.qtyL || row.costQty) / 1000,
        }));
    }

    async accountBalance(): Promise<AccountBalance> {
        const date = new Date().toISOString().slice(0, 10);
        try {
            const res = await this.cached('balance', 60_000, () =>
                this.sdk.getBalance(),
            );
            return {
                acc_balance: num(res.availableBalance),
                date,
                errmsg: '',
            };
        } catch (err) {
            return {
                acc_balance: 0,
                date,
                errmsg: err instanceof Error ? err.message : String(err),
            };
        }
    }

    async margin(): Promise<Margin> {
        return zeroMargin(); // 玉山 API 無期貨帳戶
    }

    async profitLoss(
        beginDate: string,
        endDate: string,
        accountType: AccountTypeName,
    ): Promise<PnlRow[]> {
        if (accountType !== 'S') return [];
        const rows = await this.cached(
            `txn:${beginDate}:${endDate}`,
            120_000,
            () => this.sdk.getTransactions({ startDate: beginDate, endDate }),
        );
        const byDate = new Map<string, number>();
        for (const row of rows) {
            const dats = (row.matDats ?? row.mat_dats ?? []) as Record<
                string,
                unknown
            >[];
            for (const d of dats) {
                const raw = String(d.tDate ?? d.t_date ?? '');
                const date = raw.includes('-')
                    ? raw
                    : raw.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
                if (!date) continue;
                byDate.set(
                    date,
                    (byDate.get(date) ?? 0) +
                        num((d.make ?? 0) as string | number),
                );
            }
        }
        return [...byDate.entries()]
            .map(([date, pnl]) => ({ date, pnl }))
            .sort((a, b) => a.date.localeCompare(b.date));
    }
}
