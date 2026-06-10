// server/src/providers/fubon/trading.ts — Fubon NEO (新一代API) trading.
//
// Status: written to "connectable" level against the official docs only —
// the fubon-neo SDK is a manually-downloaded .tgz (not on npm), so this
// has never executed against the real library. Before first live use:
//   1. drop fubon-neo-<version>.tgz into server/vendor/ and
//      `pnpm --filter nova-pro-server add file:vendor/fubon-neo-<v>.tgz`
//   2. resolve every TODO(verify) here and in map.ts against the SDK's
//      actual typings / runtime shapes
//   3. test with the smallest possible odd-lot order
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
import type { ContractKey } from '../market-data.ts';
import {
    TradeNotFoundError,
    zeroMargin,
    type TradingProvider,
} from '../trading.ts';
import { mapFuturesOrder, mapOrderStatus, mapStockOrder, type FubonEnums } from './map.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnySdk = any;

interface OrderRef {
    accountType: AccountTypeName;
    key: ContractKey;
    /** SDK-side handles needed for cancel/modify — TODO(verify) exact shape */
    orderNo: string;
    seqNo: string;
    sdkOrderResult: unknown;
    trade: Trade;
}

export class FubonTradingProvider implements TradingProvider {
    private sdk: AnySdk = null;
    private enums: FubonEnums | null = null;
    private stockAccount: AnySdk = null;
    private futAccount: AnySdk = null;
    private orders = new Map<string, OrderRef>();
    private eventCbs: ((ev: OrderEventData) => void)[] = [];

    constructor(private config: Config) {}

    capabilities() {
        return { futures: true };
    }

    async init(): Promise<void> {
        const { idNo, password, certPath, certPass } = this.config.broker;
        if (!idNo || !password || !certPath) {
            throw new Error(
                'TRADE_PROVIDER=fubon 需要 BROKER_ID_NO / BROKER_PASSWORD / BROKER_CERT_PATH / BROKER_CERT_PASS',
            );
        }
        let mod: AnySdk;
        try {
            mod = await import('fubon-neo' as string);
        } catch {
            throw new Error(
                '找不到 fubon-neo SDK — 請從富邦官網下載 .tgz 放入 server/vendor/ 並執行 ' +
                    'pnpm --filter nova-pro-server add file:vendor/fubon-neo-<version>.tgz',
            );
        }
        this.enums = {
            BSAction: mod.BSAction,
            MarketType: mod.MarketType,
            PriceType: mod.PriceType,
            TimeInForce: mod.TimeInForce,
            OrderType: mod.OrderType,
            FutOptMarketType: mod.FutOptMarketType,
            FutOptPriceType: mod.FutOptPriceType,
            FutOptOrderType: mod.FutOptOrderType,
        };
        this.sdk = new mod.FubonSDK();
        const result = this.sdk.login(idNo, password, certPath, certPass);
        const accounts = result?.data ?? result;
        if (!Array.isArray(accounts) || accounts.length === 0) {
            throw new Error(`Fubon 登入失敗: ${JSON.stringify(result?.message ?? result)}`);
        }
        // TODO(verify): how stock vs futures accounts are distinguished
        this.stockAccount =
            accounts.find((a: AnySdk) => a.accountType !== 'futopt') ??
            accounts[0];
        this.futAccount =
            accounts.find((a: AnySdk) => a.accountType === 'futopt') ?? null;

        // 主動回報 — TODO(verify): callback registration names & payloads
        // (docs: trading/guide/report_example)
        this.sdk.setOnOrder?.((content: AnySdk) =>
            this.emitFromCallback('New', content),
        );
        this.sdk.setOnOrderChanged?.((content: AnySdk) =>
            this.emitFromCallback('Change', content),
        );
        this.sdk.setOnFilled?.((content: AnySdk) =>
            this.emitFromCallback('Deal', content),
        );
        this.sdk.connectWebsocket?.();
    }

    private emitFromCallback(opType: string, content: AnySdk): void {
        // TODO(verify): real payload fields — mapped defensively for now
        const data = content?.data ?? content ?? {};
        const ref = [...this.orders.values()].find(
            (r) => r.orderNo === (data.orderNo ?? data.order_no),
        );
        const ev: OrderEventData = {
            operation: {
                op_type: opType,
                op_code: data.isSuccess === false ? '99' : '00',
                op_msg: String(data.errorMessage ?? data.message ?? ''),
            },
            order: {
                id: ref?.trade.order.id,
                seqno: ref?.trade.order.seqno ?? String(data.seqNo ?? ''),
                ordno: String(data.orderNo ?? ''),
                action: ref?.trade.order.action,
                price: Number(data.price ?? ref?.trade.order.price ?? 0),
                quantity: Number(
                    data.filledQty ?? data.quantity ?? ref?.trade.order.quantity ?? 0,
                ),
            },
            contract: { code: String(data.symbol ?? ref?.key.code ?? '') },
            status: {},
        };
        if (opType === 'Deal') {
            ev.code = String(data.symbol ?? ref?.key.code ?? '');
            ev.price = Number(data.filledPrice ?? data.price ?? 0);
            ev.quantity = Number(data.filledQty ?? data.quantity ?? 0);
            ev.action = ref?.trade.order.action;
        }
        for (const cb of this.eventCbs) cb(ev);
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
                broker_id: String(this.stockAccount.branchNo ?? 'FBS'),
                account_id: String(this.stockAccount.account ?? ''),
                signed: true,
                username: String(this.stockAccount.name ?? ''),
            });
        }
        if (this.futAccount) {
            out.push({
                account_type: 'F',
                person_id: this.config.broker.idNo,
                broker_id: String(this.futAccount.branchNo ?? 'FBSF'),
                account_id: String(this.futAccount.account ?? ''),
                signed: true,
                username: String(this.futAccount.name ?? ''),
            });
        }
        return out;
    }

    private buildTrade(
        key: ContractKey,
        _accountType: AccountTypeName,
        action: Action,
        price: number,
        quantity: number,
        res: AnySdk,
    ): Trade {
        const id = randomUUID();
        const data = res?.data ?? res ?? {};
        return {
            contract: {
                exchange: (key.exchange ?? 'TSE') as Trade['contract']['exchange'],
                code: key.code,
                security_type: key.security_type,
                target_code: null,
            },
            order: {
                id,
                seqno: String(data.seqNo ?? ''),
                ordno: String(data.orderNo ?? ''),
                action,
                price,
                quantity,
            },
            status: {
                id,
                status: mapOrderStatus(Number(data.status ?? 10)),
                status_code: '00',
                order_ts: Date.now(),
                order_quantity: quantity,
                deal_quantity: Number(data.filledQty ?? 0),
                cancel_quantity: 0,
                modified_price: 0,
                msg: String(data.errorMessage ?? ''),
                deals: [],
            },
        };
    }

    async placeStockOrder(
        key: ContractKey,
        order: StockOrderReq,
    ): Promise<Trade> {
        const res = this.sdk.stock.placeOrder(
            this.stockAccount,
            mapStockOrder(this.enums!, key.code, order),
            false,
        );
        if (res?.isSuccess === false) {
            throw new Error(`下單失敗: ${res.message ?? JSON.stringify(res)}`);
        }
        const trade = this.buildTrade(
            key, 'S', order.action, order.price, order.quantity, res,
        );
        this.orders.set(trade.order.id, {
            accountType: 'S',
            key,
            orderNo: trade.order.ordno,
            seqNo: trade.order.seqno,
            sdkOrderResult: res?.data ?? res,
            trade,
        });
        return trade;
    }

    async placeFuturesOrder(
        key: ContractKey,
        order: FuturesOrderReq,
    ): Promise<Trade> {
        if (!this.futAccount) {
            throw new Error('此帳號未開立期貨戶');
        }
        const res = this.sdk.futopt.placeOrder(
            this.futAccount,
            mapFuturesOrder(
                this.enums!,
                key.code,
                order,
                key.security_type === 'OPT',
            ),
        );
        if (res?.isSuccess === false) {
            throw new Error(`期權下單失敗: ${res.message ?? JSON.stringify(res)}`);
        }
        const trade = this.buildTrade(
            key, 'F', order.action, order.price, order.quantity, res,
        );
        this.orders.set(trade.order.id, {
            accountType: 'F',
            key,
            orderNo: trade.order.ordno,
            seqNo: trade.order.seqno,
            sdkOrderResult: res?.data ?? res,
            trade,
        });
        return trade;
    }

    private getRef(tradeId: string): OrderRef {
        const ref = this.orders.get(tradeId);
        if (!ref) throw new TradeNotFoundError(tradeId);
        return ref;
    }

    private api(ref: OrderRef): AnySdk {
        return ref.accountType === 'S' ? this.sdk.stock : this.sdk.futopt;
    }

    private account(ref: OrderRef): AnySdk {
        return ref.accountType === 'S' ? this.stockAccount : this.futAccount;
    }

    async cancel(tradeId: string): Promise<Trade> {
        const ref = this.getRef(tradeId);
        // TODO(verify): cancelOrder signature (account, orderResult)
        this.api(ref).cancelOrder(this.account(ref), ref.sdkOrderResult);
        ref.trade.status.status = 'Cancelled';
        return ref.trade;
    }

    async updatePrice(tradeId: string, price: number): Promise<Trade> {
        const ref = this.getRef(tradeId);
        // TODO(verify): modifyPrice signature & price representation
        this.api(ref).modifyPrice(
            this.account(ref),
            ref.sdkOrderResult,
            String(price),
        );
        ref.trade.order.price = price;
        ref.trade.status.modified_price = price;
        return ref.trade;
    }

    async updateQty(tradeId: string, quantity: number): Promise<Trade> {
        const ref = this.getRef(tradeId);
        // TODO(verify): modifyQuantity semantics (absolute vs reduce-by)
        this.api(ref).modifyQuantity(
            this.account(ref),
            ref.sdkOrderResult,
            quantity,
        );
        ref.trade.order.quantity = quantity;
        return ref.trade;
    }

    async trades(accountType: AccountTypeName): Promise<Trade[]> {
        const account = accountType === 'S' ? this.stockAccount : this.futAccount;
        if (!account) return [];
        const api = accountType === 'S' ? this.sdk.stock : this.sdk.futopt;
        const res = api.getOrderResults(account);
        const rows: AnySdk[] = res?.data ?? [];
        // TODO(verify): field names of OrderResult rows
        return rows.map((row): Trade => {
            const known = [...this.orders.values()].find(
                (r) => r.orderNo === String(row.orderNo ?? ''),
            );
            const id = known?.trade.order.id ?? `fubon-${row.orderNo}`;
            const quantity = Number(row.afterQty ?? row.quantity ?? 0);
            const trade: Trade = {
                contract: {
                    exchange: 'TSE',
                    code: String(row.symbol ?? known?.key.code ?? ''),
                    security_type: accountType === 'S' ? 'STK' : 'FUT',
                    target_code: null,
                },
                order: {
                    id,
                    seqno: String(row.seqNo ?? ''),
                    ordno: String(row.orderNo ?? ''),
                    action:
                        String(row.buySell ?? '').toLowerCase().startsWith('s')
                            ? 'Sell'
                            : 'Buy',
                    price: Number(row.price ?? 0),
                    quantity,
                },
                status: {
                    id,
                    status: mapOrderStatus(Number(row.status ?? 10)),
                    status_code: '00',
                    order_quantity: quantity,
                    deal_quantity: Number(row.filledQty ?? 0),
                    cancel_quantity: Number(row.canceledQty ?? 0),
                    modified_price: 0,
                    msg: '',
                    deals: [],
                },
            };
            if (known) known.trade = trade;
            return trade;
        });
    }

    async positions(accountType: AccountTypeName): Promise<Position[]> {
        if (accountType === 'S') {
            const res = this.sdk.accounting?.inventories?.(this.stockAccount);
            const rows: AnySdk[] = res?.data ?? [];
            // TODO(verify): inventories row fields (docs: accountManagement/Inventories)
            return rows.map((row, i) => ({
                id: i,
                code: String(row.stockNo ?? row.symbol ?? ''),
                direction: 'Buy' as Action,
                quantity: Math.round(Number(row.todayQty ?? row.quantity ?? 0) / 1000),
                price: Number(row.costPrice ?? row.avgPrice ?? 0),
                last_price: Number(row.lastPrice ?? 0),
                pnl: Number(row.unrealizedPnl ?? row.pnl ?? 0),
                yd_quantity: Math.round(Number(row.ydQty ?? 0) / 1000),
            }));
        }
        if (!this.futAccount) return [];
        const res = this.sdk.futopt.singlePosition?.(this.futAccount);
        const rows: AnySdk[] = res?.data ?? [];
        // TODO(verify): SinglePosition row fields
        return rows.map((row, i) => ({
            id: i,
            code: String(row.symbol ?? ''),
            direction:
                String(row.buySell ?? '').toLowerCase().startsWith('s')
                    ? ('Sell' as Action)
                    : ('Buy' as Action),
            quantity: Number(row.lot ?? row.quantity ?? 0),
            price: Number(row.price ?? 0),
            last_price: Number(row.lastPrice ?? 0),
            pnl: Number(row.unrealizedPnl ?? row.pnl ?? 0),
        }));
    }

    async accountBalance(): Promise<AccountBalance> {
        // TODO(verify): bank balance API (docs: accountManagement/Balance)
        const res = this.sdk.accounting?.balance?.(this.stockAccount);
        return {
            acc_balance: Number(res?.data?.balance ?? res?.data?.availableBalance ?? 0),
            date: new Date().toISOString().slice(0, 10),
            errmsg: '',
        };
    }

    async margin(): Promise<Margin> {
        if (!this.futAccount) return zeroMargin();
        // TODO(verify): QueryEquity field names (docs: accountManagement/QueryEquity)
        const res = this.sdk.futopt.queryEquity?.(this.futAccount);
        const d: AnySdk = res?.data ?? {};
        return {
            ...zeroMargin(),
            yesterday_balance: Number(d.yesterdayBalance ?? 0),
            today_balance: Number(d.todayBalance ?? 0),
            initial_margin: Number(d.initialMargin ?? 0),
            maintenance_margin: Number(d.maintenanceMargin ?? 0),
            margin_call: Number(d.marginCall ?? 0),
            risk_indicator: Number(d.riskIndicator ?? 0),
            equity: Number(d.equity ?? 0),
            equity_amount: Number(d.equityAmount ?? d.equity ?? 0),
            available_margin: Number(d.availableMargin ?? 0),
            future_settle_profitloss: Number(d.futureSettleProfitLoss ?? 0),
        };
    }

    async profitLoss(
        beginDate: string,
        endDate: string,
        _accountType: AccountTypeName,
    ): Promise<PnlRow[]> {
        // TODO(verify): RealizedPnLDetail / AccountStatement aggregation
        const res = this.sdk.accounting?.realizedPnLDetail?.(
            this.stockAccount,
            beginDate.replace(/-/g, ''),
            endDate.replace(/-/g, ''),
        );
        const rows: AnySdk[] = res?.data ?? [];
        const byDate = new Map<string, number>();
        for (const row of rows) {
            const date = String(row.date ?? '').replace(
                /^(\d{4})(\d{2})(\d{2})$/,
                '$1-$2-$3',
            );
            byDate.set(date, (byDate.get(date) ?? 0) + Number(row.pnl ?? 0));
        }
        return [...byDate.entries()]
            .map(([date, pnl]) => ({ date, pnl }))
            .sort((a, b) => a.date.localeCompare(b.date));
    }
}
