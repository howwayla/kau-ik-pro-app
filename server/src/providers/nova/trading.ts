// server/src/providers/nova/trading.ts — Taishin Nova (taishin-sdk) trading.
//
// Written against taishin-sdk 1.0.2 (napi typings in core.d.ts) and the
// official Nova docs. Implementation notes:
//   - the SDK is synchronous (napi over a Rust core) and ships as a .tgz:
//     `pnpm --filter nova-pro-server add file:vendor/taishin-sdk-<v>.tgz`
//   - the constructor MUST receive the API base URL; the production
//     endpoint is https://fugletrade.tssco.com.tw (an empty default makes
//     login die with "EOF while parsing a value"). Override with
//     BROKER_API_URL for the test environment.
//   - one account allows ONE active API session. registerApiAuth fails
//     with OA0027 when another process using the same account holds it —
//     we tolerate that, but accounting queries may come back empty until
//     the other session is closed.
//   - cancel = stock.modifyVolume(account, orderRecord, 0); there is no
//     separate cancelOrder. Modify calls take a fresh OrderRecord row, so
//     we re-query getOrderResults right before each cancel/modify.
//
// Nova supports STOCKS ONLY — capabilities().futures === false, the
// frontend hides futures/options order UI based on /info.

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
    mapAckOpType,
    mapStockOrder,
    num,
    toAppQty,
    toShares,
    type NovaAccount,
    type NovaOrderRecord,
    type NovaSdk,
} from './map.ts';

const PROD_URL = 'https://fugletrade.tssco.com.tw';

export class NovaTradingProvider implements TradingProvider {
    private sdk!: NovaSdk;
    private account!: NovaAccount;
    private eventCbs: ((ev: OrderEventData) => void)[] = [];
    /** app trade id → 委託書號, plus the last Trade we built for it */
    private refs = new Map<string, { orderNo: string; trade: Trade }>();
    private idByOrderNo = new Map<string, string>();

    constructor(private config: Config) {}

    capabilities() {
        return { futures: false };
    }

    async init(): Promise<void> {
        const { idNo, password, certPath, certPass, apiUrl } =
            this.config.broker;
        if (!idNo || !password || !certPath) {
            throw new Error(
                'TRADE_PROVIDER=nova 需要 BROKER_ID_NO / BROKER_PASSWORD / BROKER_CERT_PATH / BROKER_CERT_PASS',
            );
        }
        let mod: { TaishinSDK: new (url?: string | null) => NovaSdk };
        try {
            mod = await import('taishin-sdk' as string);
        } catch {
            throw new Error(
                '找不到 taishin-sdk — 請將 taishin-sdk-<version>.tgz 放入 server/vendor/ 並執行 ' +
                    'pnpm --filter nova-pro-server add file:vendor/taishin-sdk-<version>.tgz',
            );
        }
        this.sdk = new mod.TaishinSDK(apiUrl || PROD_URL);
        const accounts = this.sdk.login(
            idNo,
            password,
            certPath,
            certPass || undefined,
        );
        const account = accounts?.[0];
        if (!account) {
            throw new Error('Nova 登入失敗：沒有可用帳號');
        }
        this.account = account;
        try {
            this.sdk.registerApiAuth(account);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!msg.includes('OA0027')) throw err;
            console.warn(
                'nova: registerApiAuth 回 OA0027（API session 被其他程式佔用）' +
                    '— 帳務查詢可能回空，請關閉其他連線（如 fugle-trade MCP）後重啟',
            );
        }

        this.sdk.setOnOrder((err, ack) => {
            if (err || !ack) return;
            const id = this.idByOrderNo.get(ack.orderNo);
            const ev: OrderEventData = {
                operation: {
                    op_type: mapAckOpType(ack.act),
                    op_code: isErrCode(ack.errCode) ? ack.errCode! : '00',
                    op_msg: ack.errMsg ?? '',
                },
                order: {
                    id,
                    seqno: ack.orderSeqNo,
                    ordno: ack.orderNo,
                    action: ack.buySell as Action,
                    price: ack.orderPrice,
                    quantity: toAppQty(ack.afterQty, ack.marketType),
                },
                contract: { code: ack.symbol },
                status: {},
            };
            this.emit(ev);
        });
        this.sdk.setOnFilled((err, mat) => {
            if (err || !mat) return;
            const id = this.idByOrderNo.get(mat.orderNo);
            const quantity = toAppQty(mat.filledQty, mat.marketType);
            this.emit({
                operation: { op_type: 'Deal', op_code: '00', op_msg: '' },
                order: {
                    id,
                    seqno: mat.orderSeqNo,
                    ordno: mat.orderNo,
                    action: mat.buySell as Action,
                    price: mat.filledPrice,
                    quantity,
                },
                contract: { code: mat.symbol },
                status: {},
                code: mat.symbol,
                price: mat.filledPrice,
                quantity,
                action: mat.buySell as Action,
            });
        });
        this.sdk.setOnError((_err, msg) => {
            console.warn(`nova: websocket error: ${msg}`);
        });
        this.sdk.setOnDisconnected((_err, msg) => {
            console.warn(`nova: websocket disconnected: ${msg}`);
        });
        this.sdk.connectWebsocket();
        console.log(
            `nova: 登入成功 ${account.branchName ?? ''}-${account.account}`,
        );
    }

    private emit(ev: OrderEventData): void {
        for (const cb of this.eventCbs) cb(ev);
    }

    /**
     * 台新 Nova 自帶行情（initRealtime 後的 @fugle/marketdata clients）。
     * makeWs 每次重新 initRealtime 換新 token，斷線重連才不會用到過期授權。
     * 注意台新行情上限：WS 300 訂閱 / 2 連線（stock + futopt 恰好用滿）。
     */
    marketdataSource(): MarketClientSource {
        return {
            makeRest: () => {
                if (!this.sdk.marketdata) {
                    this.sdk.initRealtime(this.account);
                }
                return this.sdk.marketdata!.restClient;
            },
            makeWs: () => {
                this.sdk.initRealtime(this.account);
                return this.sdk.marketdata!.webSocketClient;
            },
        };
    }

    onOrderEvent(cb: (ev: OrderEventData) => void): void {
        this.eventCbs.push(cb);
    }

    async accounts(): Promise<Account[]> {
        return [
            {
                account_type: 'S',
                person_id: this.config.broker.idNo,
                broker_id: this.account.branchName ?? 'TSSCO',
                account_id: this.account.account,
                signed: true,
                username: this.account.name ?? '',
            },
        ];
    }

    /** deterministic trade id — survives server restarts so the UI's
     * cached list stays cancellable */
    private tradeId(orderNo: string): string {
        let id = this.idByOrderNo.get(orderNo);
        if (!id) {
            id = orderNo ? `nova-${orderNo}` : randomUUID();
            this.idByOrderNo.set(orderNo, id);
        }
        return id;
    }

    private rowToTrade(row: NovaOrderRecord): Trade {
        const orderNo = row.orderNo ?? '';
        const id = this.tradeId(orderNo);
        const marketType = row.marketType;
        const trade: Trade = {
            contract: {
                exchange: 'TSE',
                code: row.symbol ?? '',
                security_type: 'STK',
                target_code: null,
            },
            order: {
                id,
                seqno: row.seqNo ?? '',
                ordno: orderNo,
                action: (row.buySell ?? 'Buy') as Action,
                price: row.orderPrice,
                quantity: toAppQty(row.orgQty, marketType),
                order_type: row.timeInForce as Trade['order']['order_type'],
                price_type: row.priceType === 'Market' ? 'MKT' : 'LMT',
                order_lot: marketType,
            },
            status: {
                id,
                status: deriveStatus(row),
                status_code: isErrCode(row.errCode) ? row.errCode! : '00',
                order_quantity: toAppQty(row.orgQty, marketType),
                deal_quantity: toAppQty(row.filledQty, marketType),
                cancel_quantity: toAppQty(row.celQty, marketType),
                modified_price: 0,
                msg: row.errMsg ?? '',
                deals: [],
            },
        };
        this.refs.set(id, { orderNo, trade });
        return trade;
    }

    async placeStockOrder(
        key: ContractKey,
        order: StockOrderReq,
    ): Promise<Trade> {
        const novaOrder = mapStockOrder(key.code, order);
        const res = this.sdk.stock.placeOrder(this.account, novaOrder);
        const id = this.tradeId(res.orderNo);
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
                ordno: res.orderNo,
                action: order.action,
                price: order.price,
                quantity: order.quantity,
                order_type: order.order_type,
                price_type: order.price_type,
                order_lot: novaOrder.marketType,
            },
            status: {
                id,
                status: res.isPreOrder ? 'PreSubmitted' : 'Submitted',
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
        this.refs.set(id, { orderNo: res.orderNo, trade });
        return trade;
    }

    async placeFuturesOrder(
        _key: ContractKey,
        _order: FuturesOrderReq,
    ): Promise<Trade> {
        throw new FuturesNotSupportedError();
    }

    /** modify/cancel need a fresh OrderRecord — query it by 委託書號 */
    private freshRow(tradeId: string): {
        ref: { orderNo: string; trade: Trade };
        row: NovaOrderRecord;
    } {
        let ref = this.refs.get(tradeId);
        if (!ref && tradeId.startsWith('nova-')) {
            // server restarted since the UI fetched this id — recover the
            // 委託書號 from the deterministic id
            ref = { orderNo: tradeId.slice(5), trade: undefined as never };
        }
        if (!ref) throw new TradeNotFoundError(tradeId);
        const rows = this.sdk.stock.getOrderResults(this.account);
        const row = rows.find((r) => r.orderNo === ref.orderNo);
        if (!row) throw new TradeNotFoundError(tradeId);
        return { ref, row };
    }

    async cancel(tradeId: string): Promise<Trade> {
        const { row } = this.freshRow(tradeId);
        this.sdk.stock.modifyVolume(this.account, row, 0); // 0 = 刪單
        const trade = this.rowToTrade(row);
        trade.status.status = 'Cancelled';
        trade.status.cancel_quantity =
            trade.status.order_quantity - trade.status.deal_quantity;
        return trade;
    }

    async updatePrice(tradeId: string, price: number): Promise<Trade> {
        const { row } = this.freshRow(tradeId);
        this.sdk.stock.modifyPrice(this.account, row, String(price), 'Limit');
        const trade = this.rowToTrade(row);
        trade.order.price = price;
        trade.status.modified_price = price;
        return trade;
    }

    async updateQty(tradeId: string, quantity: number): Promise<Trade> {
        const { row } = this.freshRow(tradeId);
        // modifyVolume takes the number of shares to REMOVE from the order
        // (官方文件: 刪減的股數, 0 = 刪單) — the app passes the new target
        // quantity, so convert to a reduction.
        const targetShares = toShares(quantity, row.marketType);
        const liveShares = row.orgQty - row.celQty;
        const removeShares = liveShares - targetShares;
        if (removeShares <= 0) {
            throw new Error('Nova 改量僅支援減量（不可加量）');
        }
        this.sdk.stock.modifyVolume(this.account, row, removeShares);
        const trade = this.rowToTrade(row);
        trade.order.quantity = quantity;
        trade.status.order_quantity = quantity;
        return trade;
    }

    async trades(accountType: AccountTypeName): Promise<Trade[]> {
        if (accountType !== 'S') return [];
        const rows = this.sdk.stock.getOrderResults(this.account);
        return rows.map((row) => this.rowToTrade(row));
    }

    async positions(accountType: AccountTypeName): Promise<Position[]> {
        if (accountType !== 'S') return [];
        const res = this.sdk.accounting.inventories(this.account);
        const rows = res?.positionSummaries ?? [];
        return rows.map((row, i) => {
            const shares = num(row.currentQuantity);
            // 實測（2026-06-11 對 MCP ground truth）：positionSummaries 不帶
            // unrealizedProfit，未實現損益要看 totalProfit（= 各 detail 的
            // unrealizedProfitLoss 加總）。
            const pnl = row.totalProfit
                ? num(row.totalProfit)
                : (row.positionDetails ?? []).reduce(
                      (sum, d) => sum + num(d.unrealizedProfitLoss),
                      0,
                  ) || num(row.unrealizedProfit);
            return {
                id: i,
                code: row.symbol ?? '',
                direction: (row.buySell === 'Sell' ? 'Sell' : 'Buy') as Action,
                quantity: shares / 1000,
                price: num(row.averagePrice),
                last_price: num(row.currentPrice),
                pnl,
                yd_quantity: num(row.prevDayQuantity) / 1000,
            };
        });
    }

    async accountBalance(): Promise<AccountBalance> {
        try {
            const rows = this.sdk.accounting.bankBalance(this.account);
            const balance = rows.reduce(
                (sum, r) => sum + num(r.availableBalance),
                0,
            );
            return {
                acc_balance: balance,
                date: new Date().toISOString().slice(0, 10),
                errmsg: '',
            };
        } catch (err) {
            return {
                acc_balance: 0,
                date: new Date().toISOString().slice(0, 10),
                errmsg: err instanceof Error ? err.message : String(err),
            };
        }
    }

    async margin(): Promise<Margin> {
        return zeroMargin(); // Nova 無期貨帳戶
    }

    async profitLoss(
        beginDate: string,
        endDate: string,
        accountType: AccountTypeName,
    ): Promise<PnlRow[]> {
        if (accountType !== 'S') return [];
        const res = this.sdk.accounting.realizedProfitAndLoses(
            this.account,
            beginDate.replace(/-/g, ''),
            endDate.replace(/-/g, ''),
        );
        const byDate = new Map<string, number>();
        for (const row of res?.profitLossSummary ?? []) {
            const date = String(row.tDate ?? '').replace(
                /^(\d{4})(\d{2})(\d{2})$/,
                '$1-$2-$3',
            );
            if (!date) continue;
            byDate.set(date, (byDate.get(date) ?? 0) + num(row.profitLoss));
        }
        return [...byDate.entries()]
            .map(([date, pnl]) => ({ date, pnl }))
            .sort((a, b) => a.date.localeCompare(b.date));
    }
}
