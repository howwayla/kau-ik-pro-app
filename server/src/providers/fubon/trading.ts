// server/src/providers/fubon/trading.ts — Fubon NEO (新一代API) trading.
//
// Verified against fubon-neo 2.2.2 trade.d.ts, the sdk-core 2.2.8 source
// and the official docs — see map.ts for the fact list. The SDK ships as
// a manually-downloaded .tgz (not on npm):
//   pnpm --filter nova-pro-server add file:vendor/fubon-neo-<version>.tgz
// Every call is synchronous and returns Response{isSuccess, data, message}.
// Order reports stream automatically after login via the (err, event)
// callbacks — no manual websocket connect step.
//
// Capabilities: stocks AND futures/options (sdk.futopt.*).

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
    ConditionOrderError,
    TradeNotFoundError,
    zeroMargin,
    type BracketSpec,
    type ConditionOrderRow,
    type TradingProvider,
} from '../trading.ts';
import {
    buildEntryCondition,
    buildFutConditionOrder,
    buildStockConditionOrder,
    buildTpslWrapper,
    conditionDates,
    mapConditionDetail,
    mapFuturesOrder,
    mapOrderStatus,
    mapStockOrder,
    toAppQty,
    toShares,
    type FubonAccount,
    type FubonFilledData,
    type FubonFutOptFilledData,
    type FubonFutOptOrderResult,
    type FubonOrderResult,
    type FubonResponse,
    type FubonSdk,
} from './map.ts';

interface OrderRef {
    accountType: AccountTypeName;
    orderNo: string;
    trade: Trade;
}

function unwrap<T>(res: FubonResponse<T>, what: string): T {
    if (!res?.isSuccess || res.data === undefined) {
        throw new Error(`${what}失敗: ${res?.message ?? JSON.stringify(res)}`);
    }
    return res.data;
}

export class FubonTradingProvider implements TradingProvider {
    private sdk!: FubonSdk;
    private stockAccount: FubonAccount | null = null;
    private futAccount: FubonAccount | null = null;
    private refs = new Map<string, OrderRef>();
    private idByOrderNo = new Map<string, string>();
    private eventCbs: ((ev: OrderEventData) => void)[] = [];

    constructor(private config: Config) {}

    capabilities() {
        return { futures: true, condition_orders: true };
    }

    async init(): Promise<void> {
        const { idNo, password, apiKey, certPath, certPass } =
            this.config.broker;
        if (!idNo || (!password && !apiKey) || !certPath) {
            throw new Error(
                'TRADE_PROVIDER=fubon 需要 BROKER_ID_NO / BROKER_PASSWORD（或 BROKER_API_KEY）/ BROKER_CERT_PATH / BROKER_CERT_PASS',
            );
        }
        let mod: { FubonSDK: new () => FubonSdk };
        try {
            mod = await import('fubon-neo' as string);
        } catch {
            throw new Error(
                '找不到 fubon-neo SDK — 請從富邦官網下載 .tgz 放入 server/vendor/ 並執行 ' +
                    'pnpm --filter nova-pro-server add file:vendor/fubon-neo-<version>.tgz',
            );
        }
        this.sdk = new mod.FubonSDK();
        // API key 登入（v2.2.7+）仍需憑證;優先於帳號密碼
        const result = apiKey
            ? this.sdk.apikeyLogin(idNo, apiKey, certPath, certPass)
            : this.sdk.login(idNo, password, certPath, certPass);
        const accounts = unwrap(result, 'Fubon 登入');
        if (accounts.length === 0) {
            throw new Error('Fubon 登入失敗：沒有可用帳號');
        }
        // Account.accountType = 'stock' | 'futopt' (sdk-core recover.rs)
        this.stockAccount =
            accounts.find((a) => a.accountType === 'stock') ??
            accounts[0] ??
            null;
        this.futAccount =
            accounts.find((a) => a.accountType === 'futopt') ?? null;

        // 主動回報 — napi callbacks are (err, event) pairs; order reports
        // flow automatically after login.
        this.sdk.setOnOrder((err, order) => {
            if (!err && order) this.emitAck(order, 'S');
        });
        this.sdk.setOnOrderChanged((err, order) => {
            if (!err && order) this.emitAck(order, 'S');
        });
        this.sdk.setOnFilled((err, fill) => {
            if (!err && fill) this.emitStockFill(fill);
        });
        this.sdk.setOnFutoptOrder((err, order) => {
            if (!err && order) this.emitFutAck(order);
        });
        this.sdk.setOnFutoptOrderChanged((err, order) => {
            if (!err && order) this.emitFutAck(order);
        });
        this.sdk.setOnFutoptFilled((err, fill) => {
            if (!err && fill) this.emitFutFill(fill);
        });
        console.log(
            `fubon: 登入成功 證券 ${this.stockAccount?.branchNo}-${this.stockAccount?.account}` +
                (this.futAccount
                    ? `, 期貨 ${this.futAccount.branchNo}-${this.futAccount.account}`
                    : ''),
        );
    }

    // 委託主動回報沒有獨立的「新單/刪單/改單」事件型別 — 從 status 與
    // before/after 欄位推斷 op_type（mock 的字彙: New/Cancel/UpdateQty/
    // UpdatePrice/Deal）。
    private ackOpType(order: {
        status?: number;
        beforeQty?: number;
        afterQty?: number;
        beforePrice?: number;
        afterPrice?: number;
    }): string {
        if (order.status === 30) return 'Cancel';
        if (
            order.beforeQty !== undefined &&
            order.afterQty !== undefined &&
            order.afterQty < order.beforeQty
        ) {
            return 'UpdateQty';
        }
        if (
            order.beforePrice !== undefined &&
            order.afterPrice !== undefined &&
            order.afterPrice !== order.beforePrice
        ) {
            return 'UpdatePrice';
        }
        return 'New';
    }

    private emitAck(order: FubonOrderResult, _acct: AccountTypeName): void {
        const orderNo = order.orderNo ?? '';
        const ev: OrderEventData = {
            operation: {
                op_type: this.ackOpType(order),
                op_code: order.status === 90 ? '90' : '00',
                op_msg: order.errorMessage ?? '',
            },
            order: {
                id: this.idByOrderNo.get(orderNo),
                seqno: order.seqNo,
                ordno: orderNo,
                action: order.buySell as Action,
                price: order.afterPrice ?? order.price ?? 0,
                quantity: toAppQty(
                    order.afterQty ?? order.quantity ?? 0,
                    order.marketType,
                ),
            },
            contract: { code: order.stockNo ?? '' },
            status: {},
        };
        this.emit(ev);
    }

    private emitFutAck(order: FubonFutOptOrderResult): void {
        const orderNo = order.orderNo ?? '';
        this.emit({
            operation: {
                op_type: this.ackOpType({
                    status: order.status,
                    beforeQty: order.beforeLot,
                    afterQty: order.afterLot,
                    beforePrice: order.beforePrice,
                    afterPrice: order.afterPrice,
                }),
                op_code: order.status === 90 ? '90' : '00',
                op_msg: order.errorMessage ?? '',
            },
            order: {
                id: this.idByOrderNo.get(orderNo),
                seqno: order.seqNo,
                ordno: orderNo,
                action: order.buySell as Action,
                price: order.afterPrice ?? order.price ?? 0,
                quantity: order.afterLot ?? order.lot ?? 0,
            },
            contract: { code: order.symbol ?? '' },
            status: {},
        });
    }

    private emitStockFill(fill: FubonFilledData): void {
        const id = this.idByOrderNo.get(fill.orderNo);
        // FilledData carries no marketType — recover it from the known
        // trade, falling back to 張 (Common).
        const marketType =
            (id && this.refs.get(id)?.trade.order.order_lot) || 'Common';
        const quantity = toAppQty(fill.filledQty, marketType);
        this.emit({
            operation: { op_type: 'Deal', op_code: '00', op_msg: '' },
            order: {
                id,
                seqno: fill.seqNo ?? '',
                ordno: fill.orderNo,
                action: fill.buySell as Action,
                price: fill.filledPrice,
                quantity,
            },
            contract: { code: fill.stockNo },
            status: {},
            code: fill.stockNo,
            price: fill.filledPrice,
            quantity,
            action: fill.buySell as Action,
        });
    }

    private emitFutFill(fill: FubonFutOptFilledData): void {
        const id = this.idByOrderNo.get(fill.orderNo);
        this.emit({
            operation: { op_type: 'Deal', op_code: '00', op_msg: '' },
            order: {
                id,
                seqno: fill.seqNo ?? '',
                ordno: fill.orderNo,
                action: fill.buySell as Action,
                price: fill.filledPrice,
                quantity: fill.filledLot,
            },
            contract: { code: fill.symbol },
            status: {},
            code: fill.symbol,
            price: fill.filledPrice,
            quantity: fill.filledLot,
            action: fill.buySell as Action,
        });
    }

    private emit(ev: OrderEventData): void {
        for (const cb of this.eventCbs) cb(ev);
    }

    /**
     * 富邦自帶行情。initRealtime 預設 Speed mode（不能訂 aggregates/
     * candles）— 一律明確帶 'normal'。makeWs 每次重新 initRealtime 換
     * 新 token。限制：單連線 200 訂閱、同帳號 5 連線。
     */
    marketdataSource(): MarketClientSource {
        return {
            makeRest: () => {
                if (!this.sdk.marketdata) {
                    this.sdk.initRealtime('normal');
                }
                return this.sdk.marketdata!.restClient;
            },
            makeWs: () => {
                this.sdk.initRealtime('normal');
                return this.sdk.marketdata!.webSocketClient;
            },
        };
    }

    dispose(): void {
        try {
            this.sdk?.logout();
        } catch {
            // session already gone
        }
    }

    onOrderEvent(cb: (ev: OrderEventData) => void): void {
        this.eventCbs.push(cb);
    }

    async accounts(): Promise<Account[]> {
        const out: Account[] = [];
        if (this.stockAccount) {
            out.push({
                account_type: 'S',
                person_id: this.config.broker.idNo,
                broker_id: this.stockAccount.branchNo,
                account_id: this.stockAccount.account,
                signed: true,
                username: this.stockAccount.name,
            });
        }
        if (this.futAccount) {
            out.push({
                account_type: 'F',
                person_id: this.config.broker.idNo,
                broker_id: this.futAccount.branchNo,
                account_id: this.futAccount.account,
                signed: true,
                username: this.futAccount.name,
            });
        }
        return out;
    }

    /** deterministic trade id（含帳別）— survives server restarts so the
     * UI's cached list stays cancellable */
    private tradeId(orderNo: string, accountType: AccountTypeName): string {
        let id = this.idByOrderNo.get(orderNo);
        if (!id) {
            id = orderNo ? `fubon-${accountType}-${orderNo}` : randomUUID();
            this.idByOrderNo.set(orderNo, id);
        }
        return id;
    }

    private stockRowToTrade(row: FubonOrderResult): Trade {
        const orderNo = row.orderNo ?? '';
        const id = this.tradeId(orderNo, 'S');
        const qty = row.afterQty ?? row.quantity ?? 0;
        const filled = row.filledQty ?? 0;
        const trade: Trade = {
            contract: {
                exchange: 'TSE',
                code: row.stockNo ?? '',
                security_type: 'STK',
                target_code: null,
            },
            order: {
                id,
                seqno: row.seqNo,
                ordno: orderNo,
                action: (row.buySell ?? 'Buy') as Action,
                price: row.afterPrice ?? row.price ?? 0,
                quantity: toAppQty(qty, row.marketType),
                order_type: row.timeInForce as Trade['order']['order_type'],
                price_type: row.priceType === 'Market' ? 'MKT' : 'LMT',
                order_lot: row.marketType,
            },
            status: {
                id,
                status: mapOrderStatus(row.status, filled),
                status_code: row.status === 90 ? '90' : '00',
                order_quantity: toAppQty(qty, row.marketType),
                deal_quantity: toAppQty(filled, row.marketType),
                cancel_quantity:
                    row.beforeQty !== undefined && row.afterQty !== undefined
                        ? Math.max(
                              0,
                              toAppQty(
                                  row.beforeQty - row.afterQty,
                                  row.marketType,
                              ),
                          )
                        : 0,
                modified_price: 0,
                msg: row.errorMessage ?? '',
                deals: [],
            },
        };
        this.refs.set(id, { accountType: 'S', orderNo, trade });
        return trade;
    }

    private futRowToTrade(row: FubonFutOptOrderResult): Trade {
        const orderNo = row.orderNo ?? '';
        const id = this.tradeId(orderNo, 'F');
        const lot = row.afterLot ?? row.lot ?? 0;
        const filled = row.filledLot ?? 0;
        const trade: Trade = {
            contract: {
                exchange: 'TAIFEX',
                code: row.symbol ?? '',
                security_type: row.marketType?.startsWith('Option')
                    ? 'OPT'
                    : 'FUT',
                target_code: null,
            },
            order: {
                id,
                seqno: row.seqNo,
                ordno: orderNo,
                action: (row.buySell ?? 'Buy') as Action,
                price: row.afterPrice ?? row.price ?? 0,
                quantity: lot,
                order_type: row.timeInForce as Trade['order']['order_type'],
                price_type: row.priceType === 'Market' ? 'MKT' : 'LMT',
            },
            status: {
                id,
                status: mapOrderStatus(row.status, filled),
                status_code: row.status === 90 ? '90' : '00',
                order_quantity: lot,
                deal_quantity: filled,
                cancel_quantity: 0,
                modified_price: 0,
                msg: row.errorMessage ?? '',
                deals: [],
            },
        };
        this.refs.set(id, { accountType: 'F', orderNo, trade });
        return trade;
    }

    async placeStockOrder(
        key: ContractKey,
        order: StockOrderReq,
    ): Promise<Trade> {
        if (!this.stockAccount) throw new Error('此帳號未開立證券戶');
        const res = this.sdk.stock.placeOrder(
            this.stockAccount,
            mapStockOrder(key.code, order),
        );
        const data = unwrap(res, '下單');
        const trade = this.stockRowToTrade(data);
        trade.contract.exchange = (key.exchange ??
            'TSE') as Trade['contract']['exchange'];
        return trade;
    }

    async placeFuturesOrder(
        key: ContractKey,
        order: FuturesOrderReq,
    ): Promise<Trade> {
        if (!this.futAccount) throw new Error('此帳號未開立期貨戶');
        const res = this.sdk.futopt.placeOrder(
            this.futAccount,
            mapFuturesOrder(key.code, order, key.security_type === 'OPT'),
        );
        const data = unwrap(res, '期權下單');
        return this.futRowToTrade(data);
    }

    private getRef(tradeId: string): OrderRef {
        const ref = this.refs.get(tradeId);
        if (ref) return ref;
        // server restarted since the UI fetched this id — recover from
        // the deterministic id (fubon-<S|F>-<委託書號>)
        const m = /^fubon-([SF])-(.+)$/.exec(tradeId);
        if (m && m[1] && m[2]) {
            return {
                accountType: m[1] as AccountTypeName,
                orderNo: m[2],
                trade: undefined as never,
            };
        }
        throw new TradeNotFoundError(tradeId);
    }

    /** modify/cancel want a fresh OrderResult row — re-query by 委託書號 */
    private freshStockRow(ref: OrderRef): FubonOrderResult {
        const rows = unwrap(
            this.sdk.stock.getOrderResults(this.stockAccount!),
            '委託查詢',
        );
        const row = rows.find((r) => r.orderNo === ref.orderNo);
        if (!row) throw new TradeNotFoundError(ref.trade.order.id);
        return row;
    }

    private freshFutRow(ref: OrderRef): FubonFutOptOrderResult {
        const rows = unwrap(
            this.sdk.futopt.getOrderResults(this.futAccount!),
            '期權委託查詢',
        );
        const row = rows.find((r) => r.orderNo === ref.orderNo);
        if (!row) throw new TradeNotFoundError(ref.trade.order.id);
        return row;
    }

    async cancel(tradeId: string): Promise<Trade> {
        const ref = this.getRef(tradeId);
        if (ref.accountType === 'S') {
            const row = this.freshStockRow(ref);
            const res = unwrap(
                this.sdk.stock.cancelOrder(this.stockAccount!, row),
                '刪單',
            );
            return this.stockRowToTrade(res);
        }
        const row = this.freshFutRow(ref);
        const res = unwrap(
            this.sdk.futopt.cancelOrder(this.futAccount!, row),
            '期權刪單',
        );
        return this.futRowToTrade(res);
    }

    async updatePrice(tradeId: string, price: number): Promise<Trade> {
        const ref = this.getRef(tradeId);
        if (ref.accountType === 'S') {
            const row = this.freshStockRow(ref);
            const obj = this.sdk.stock.makeModifyPriceObj(row, String(price));
            const res = unwrap(
                this.sdk.stock.modifyPrice(this.stockAccount!, obj),
                '改價',
            );
            return this.stockRowToTrade(res);
        }
        const row = this.freshFutRow(ref);
        const obj = this.sdk.futopt.makeModifyPriceObj(row, String(price));
        const res = unwrap(
            this.sdk.futopt.modifyPrice(this.futAccount!, obj),
            '期權改價',
        );
        return this.futRowToTrade(res);
    }

    async updateQty(tradeId: string, quantity: number): Promise<Trade> {
        const ref = this.getRef(tradeId);
        if (ref.accountType === 'S') {
            const row = this.freshStockRow(ref);
            // ModifyQuantity.newQuantity = 異動後有效總量（絕對值、股）
            const obj = this.sdk.stock.makeModifyQuantityObj(
                row,
                toShares(quantity, row.marketType),
            );
            const res = unwrap(
                this.sdk.stock.modifyQuantity(this.stockAccount!, obj),
                '改量',
            );
            return this.stockRowToTrade(res);
        }
        const row = this.freshFutRow(ref);
        const obj = this.sdk.futopt.makeModifyLotObj(row, quantity);
        const res = unwrap(
            this.sdk.futopt.modifyLot(this.futAccount!, obj),
            '期權改量',
        );
        return this.futRowToTrade(res);
    }

    async trades(accountType: AccountTypeName): Promise<Trade[]> {
        if (accountType === 'S') {
            if (!this.stockAccount) return [];
            const rows = unwrap(
                this.sdk.stock.getOrderResults(this.stockAccount),
                '委託查詢',
            );
            return rows.map((row) => this.stockRowToTrade(row));
        }
        if (!this.futAccount) return [];
        const rows = unwrap(
            this.sdk.futopt.getOrderResults(this.futAccount),
            '期權委託查詢',
        );
        return rows.map((row) => this.futRowToTrade(row));
    }

    async positions(accountType: AccountTypeName): Promise<Position[]> {
        if (accountType === 'S') {
            if (!this.stockAccount) return [];
            const rows = unwrap(
                this.sdk.accounting.unrealizedGainsAndLoses(this.stockAccount),
                '未實現損益查詢',
            );
            // 現股 buySell 皆為 Buy，餘額正負號顯示淨部位（官方文件）
            return rows.map((row, i) => ({
                id: i,
                code: row.stockNo,
                direction: (row.todayQty < 0 || row.buySell === 'Sell'
                    ? 'Sell'
                    : 'Buy') as Action,
                quantity: Math.abs(row.todayQty) / 1000,
                price: row.costPrice,
                last_price: 0, // SDK 不回現價；前端以行情價計算
                // 獲利/虧損分欄；虧損欄取絕對值後相減,兩種正負表示法皆成立
                pnl: row.unrealizedProfit - Math.abs(row.unrealizedLoss),
                yd_quantity: Math.abs(row.todayQty) / 1000,
            }));
        }
        if (!this.futAccount) return [];
        const rows = unwrap(
            this.sdk.futoptAccounting.querySinglePosition(this.futAccount),
            '期權部位查詢',
        );
        return rows.map((row, i) => ({
            id: i,
            code: row.symbol,
            direction: (row.buySell === 'Sell' ? 'Sell' : 'Buy') as Action,
            quantity: row.tradableLot,
            price: row.price ?? 0,
            last_price: Number(row.marketPrice) || 0,
            pnl: row.profitOrLoss,
        }));
    }

    async accountBalance(): Promise<AccountBalance> {
        const date = new Date().toISOString().slice(0, 10);
        if (!this.stockAccount) {
            return { acc_balance: 0, date, errmsg: '無證券帳戶' };
        }
        try {
            const data = unwrap(
                this.sdk.accounting.bankRemain(this.stockAccount),
                '銀行餘額查詢',
            );
            return { acc_balance: data.availableBalance, date, errmsg: '' };
        } catch (err) {
            return {
                acc_balance: 0,
                date,
                errmsg: err instanceof Error ? err.message : String(err),
            };
        }
    }

    async margin(): Promise<Margin> {
        if (!this.futAccount) return zeroMargin();
        const rows = unwrap(
            this.sdk.futoptAccounting.queryMarginEquity(this.futAccount),
            '保證金權益查詢',
        );
        const d = rows.find((r) => r.currency?.includes('TW')) ?? rows[0];
        if (!d) return zeroMargin();
        return {
            ...zeroMargin(),
            yesterday_balance: d.yesterdayBalance,
            today_balance: d.todayBalance,
            deposit_withdrawal: d.todayDeposit - d.todayWithdrawal,
            fee: d.todayTradingFee,
            tax: d.todayTradingTax,
            initial_margin: d.initialMargin,
            maintenance_margin: d.maintenanceMargin,
            equity: d.todayEquity,
            equity_amount: d.todayEquity,
            available_margin: d.availableMargin,
            plus_margin: d.excessMargin,
            option_openbuy_market_value: d.optLongValue,
            option_opensell_market_value: d.optShortValue,
            option_settle_profitloss: d.optPnl,
            future_settle_profitloss: d.futRealizedPnl,
        };
    }

    async profitLoss(
        beginDate: string,
        endDate: string,
        accountType: AccountTypeName,
    ): Promise<PnlRow[]> {
        if (accountType !== 'S' || !this.stockAccount) return [];
        // realizedGainsAndLoses 只回「當日」資料（sdk-core 2.2.8 內部呼叫
        // realized_gains_and_loses_oneday）— 仍依日期聚合並過濾區間。
        const rows = unwrap(
            this.sdk.accounting.realizedGainsAndLoses(this.stockAccount),
            '已實現損益查詢',
        );
        const byDate = new Map<string, number>();
        for (const row of rows) {
            const date = row.date.replace(/\//g, '-');
            if (date < beginDate || date > endDate) continue;
            const pnl = row.realizedProfit - Math.abs(row.realizedLoss);
            byDate.set(date, (byDate.get(date) ?? 0) + pnl);
        }
        return [...byDate.entries()]
            .map(([date, pnl]) => ({ date, pnl }))
            .sort((a, b) => a.date.localeCompare(b.date));
    }

    // ---- 券商端條件單（智慧單）— L1 protection -------------------------
    // Entry order placed AS a condition order with TP/SL children: the
    // bracket survives both closed tabs AND a dead local server.
    // All mappings are doc-derived, untested on a real account —
    // see TODO(verify) in map.ts. Failures throw ConditionOrderError so
    // routes can fall back to the server trigger engine (L2).

    async placeStockBracketCondition(
        key: ContractKey,
        order: StockOrderReq,
        bracket: BracketSpec,
    ): Promise<{ guid: string }> {
        if (!this.stockAccount) {
            throw new ConditionOrderError('尚未登入證券帳戶');
        }
        const { startDate, endDate } = conditionDates(bracket.expiry);
        let res: FubonResponse<{ guid?: string }>;
        try {
            res = this.sdk.stock.singleCondition(
                this.stockAccount,
                startDate,
                endDate,
                'Full',
                buildEntryCondition(
                    key.code,
                    order.action,
                    order.price_type === 'MKT' ? null : order.price,
                ),
                buildStockConditionOrder(key.code, order),
                buildTpslWrapper(bracket, false),
            );
        } catch (err) {
            throw new ConditionOrderError(
                err instanceof Error ? err.message : String(err),
            );
        }
        if (!res?.isSuccess || !res.data?.guid) {
            throw new ConditionOrderError(
                `券商條件單失敗: ${res?.message ?? JSON.stringify(res).slice(0, 200)}`,
            );
        }
        return { guid: res.data.guid };
    }

    async placeFuturesBracketCondition(
        key: ContractKey,
        order: FuturesOrderReq,
        bracket: BracketSpec,
    ): Promise<{ guid: string }> {
        if (!this.futAccount) {
            throw new ConditionOrderError('此帳號未開立期貨戶');
        }
        const { startDate, endDate } = conditionDates(bracket.expiry);
        let res: FubonResponse<{ guid?: string }>;
        try {
            res = this.sdk.futopt.singleCondition(
                this.futAccount,
                startDate,
                endDate,
                'Full',
                buildEntryCondition(
                    key.code,
                    order.action,
                    order.price_type === 'LMT' ? order.price : null,
                ),
                buildFutConditionOrder(
                    key.code,
                    key.security_type === 'OPT',
                    order,
                ),
                buildTpslWrapper(bracket, true),
            );
        } catch (err) {
            throw new ConditionOrderError(
                err instanceof Error ? err.message : String(err),
            );
        }
        if (!res?.isSuccess || !res.data?.guid) {
            throw new ConditionOrderError(
                `券商條件單失敗: ${res?.message ?? JSON.stringify(res).slice(0, 200)}`,
            );
        }
        return { guid: res.data.guid };
    }

    async listConditionOrders(
        accountType: AccountTypeName,
    ): Promise<ConditionOrderRow[]> {
        const account =
            accountType === 'S' ? this.stockAccount : this.futAccount;
        if (!account) return [];
        const api = accountType === 'S' ? this.sdk.stock : this.sdk.futopt;
        const res = api.getConditionOrder(account);
        if (!res?.isSuccess) return [];
        return (res.data ?? []).map((row) =>
            mapConditionDetail(row, accountType),
        );
    }

    async cancelConditionOrder(
        guid: string,
        accountType: AccountTypeName,
    ): Promise<void> {
        const account =
            accountType === 'S' ? this.stockAccount : this.futAccount;
        if (!account) throw new ConditionOrderError('帳戶未登入');
        const api = accountType === 'S' ? this.sdk.stock : this.sdk.futopt;
        const res = api.cancelConditionOrders(account, guid);
        if (!res?.isSuccess) {
            throw new ConditionOrderError(
                `撤銷條件單失敗: ${res?.message ?? ''}`,
            );
        }
    }
}
