// server/src/providers/mock/trading.ts — in-memory paper-trading ledger.
// Simulates the full order lifecycle the frontend expects: PendingSubmit
// → Submitted (order_event New) → Filled (order_event Deal with flat
// code/price/quantity, which bracket.ts uses for fast fill detection).

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
import type { ContractKey } from '../market-data.ts';
import type { PriceFeed } from '../manager.ts';
import {
    TradeNotFoundError,
    zeroMargin,
    type TradingProvider,
} from '../trading.ts';
import { hashStr, mulberry32 } from './prng.ts';
import { dateStr } from './random-walk.ts';

const INITIAL_CASH = 10_000_000;
const INITIAL_FUT_EQUITY = 2_000_000;

function marginPerLot(code: string): number {
    if (code.startsWith('MXF')) return 46_000;
    if (code.startsWith('TXO')) return 0; // buyer pays premium only (mock)
    return 184_000;
}

function futMultiplier(code: string): number {
    if (code.startsWith('TXO')) return 50;
    if (code.startsWith('MXF')) return 50;
    if (code.startsWith('TMF')) return 10;
    return 200;
}

interface OpenOrder {
    tradeId: string;
    accountType: AccountTypeName;
    key: ContractKey;
    trade: Trade;
    limitPrice: number | null; // null → market order
    walkHeld: boolean;
}

interface LedgerPosition {
    code: string;
    quantity: number; // stocks: 張 (always ≥0); futures: signed lots
    avgPrice: number;
    ydQuantity: number;
}

export class MockTradingProvider implements TradingProvider {
    private orders = new Map<string, OpenOrder>();
    private stockLedger = new Map<string, LedgerPosition>();
    private futLedger = new Map<string, LedgerPosition>();
    private cash = INITIAL_CASH;
    private futEquity = INITIAL_FUT_EQUITY;
    private realizedToday = { S: 0, F: 0 };
    private fees = 0;
    private seq = 0;
    private eventCbs: ((ev: OrderEventData) => void)[] = [];

    constructor(private feed: PriceFeed) {}

    async init(): Promise<void> {
        this.feed.onPrice((code, price) => this.checkLimitFills(code, price));
    }

    capabilities() {
        return { futures: true, condition_orders: false };
    }

    async accounts(): Promise<Account[]> {
        return [
            {
                account_type: 'S',
                person_id: 'A123456789',
                broker_id: 'MOCK',
                account_id: '0000001',
                signed: true,
                username: '模擬交易',
            },
            {
                account_type: 'F',
                person_id: 'A123456789',
                broker_id: 'MOCKF',
                account_id: '0000002',
                signed: true,
                username: '模擬交易',
            },
        ];
    }

    onOrderEvent(cb: (ev: OrderEventData) => void): void {
        this.eventCbs.push(cb);
    }

    private emit(ev: OrderEventData): void {
        for (const cb of this.eventCbs) cb(ev);
    }

    // ---- order lifecycle ----

    private buildTrade(
        key: ContractKey,
        accountType: AccountTypeName,
        action: Action,
        price: number,
        quantity: number,
        extra: Partial<Trade['order']>,
    ): Trade {
        this.seq += 1;
        const id = randomUUID();
        return {
            contract: {
                exchange: (key.exchange ?? 'TSE') as Trade['contract']['exchange'],
                code: key.code,
                security_type: key.security_type,
                target_code: null,
                name: this.feed.displayName(key.code),
            },
            order: {
                id,
                seqno: String(100000 + this.seq),
                ordno: `m${String(this.seq).padStart(4, '0')}`,
                action,
                price,
                quantity,
                account: {
                    broker_id: accountType === 'S' ? 'MOCK' : 'MOCKF',
                    account_id: accountType === 'S' ? '0000001' : '0000002',
                    account_type: accountType,
                },
                ...extra,
            },
            status: {
                id,
                status: 'PendingSubmit',
                status_code: '00',
                order_ts: Date.now(),
                order_quantity: quantity,
                deal_quantity: 0,
                cancel_quantity: 0,
                modified_price: 0,
                msg: '',
                deals: [],
            },
        };
    }

    private submit(open: OpenOrder): void {
        setTimeout(() => {
            if (open.trade.status.status !== 'PendingSubmit') return;
            open.trade.status.status = 'Submitted';
            this.emit({
                operation: { op_type: 'New', op_code: '00', op_msg: '' },
                order: this.eventOrder(open),
                contract: { code: open.key.code },
                status: { status: 'Submitted' },
            });
            this.tryImmediateFill(open);
        }, 150);
    }

    private eventOrder(open: OpenOrder) {
        const o = open.trade.order;
        return {
            id: o.id,
            seqno: o.seqno,
            ordno: o.ordno,
            action: o.action,
            price: o.price,
            quantity: o.quantity,
        };
    }

    private tryImmediateFill(open: OpenOrder): void {
        if (open.limitPrice === null) {
            setTimeout(() => void this.fillAtMarket(open), 200);
            return;
        }
        const last = this.feed.lastPrice(open.key.code);
        const { action } = open.trade.order;
        const crossed =
            last !== undefined &&
            (action === 'Buy' ? last <= open.limitPrice : last >= open.limitPrice);
        if (crossed) {
            setTimeout(() => this.fill(open, open.limitPrice!), 200);
        } else {
            // keep prices flowing so the resting order can fill on a cross
            this.feed.hold(open.key);
            open.walkHeld = true;
        }
    }

    private async fillAtMarket(open: OpenOrder): Promise<void> {
        const price =
            this.feed.lastPrice(open.key.code) ??
            (await this.feed.fetchPrice(open.key));
        if (!price || price <= 0) {
            open.trade.status.status = 'Failed';
            open.trade.status.msg = '無法取得市價（盤前或無行情資料）';
            this.emit({
                operation: {
                    op_type: 'New',
                    op_code: '99',
                    op_msg: open.trade.status.msg,
                },
                order: this.eventOrder(open),
                contract: { code: open.key.code },
                status: { status: 'Failed' },
            });
            return;
        }
        this.fill(open, price);
    }

    private checkLimitFills(code: string, price: number): void {
        for (const open of this.orders.values()) {
            if (open.limitPrice === null) continue;
            if (open.trade.status.status !== 'Submitted') continue;
            const target = this.feed.aliasTarget(open.key.code);
            if (open.key.code !== code && target !== code) continue;
            const { action } = open.trade.order;
            const crossed =
                action === 'Buy'
                    ? price <= open.limitPrice
                    : price >= open.limitPrice;
            if (crossed) this.fill(open, open.limitPrice);
        }
    }

    private releaseWalk(open: OpenOrder): void {
        if (open.walkHeld) {
            open.walkHeld = false;
            this.feed.release(open.key);
        }
    }

    private fill(open: OpenOrder, price: number): void {
        const { trade } = open;
        if (
            trade.status.status !== 'Submitted' &&
            trade.status.status !== 'PartFilled'
        ) {
            return;
        }
        const quantity =
            trade.status.order_quantity - trade.status.deal_quantity;
        if (quantity <= 0) return;
        this.releaseWalk(open);
        trade.status.deal_quantity += quantity;
        trade.status.status = 'Filled';
        trade.status.deals.push({
            seq: `${trade.order.seqno}-1`,
            price,
            quantity,
            ts: Date.now(),
        });
        this.applyFill(open, price, quantity);
        this.emit({
            operation: { op_type: 'Deal', op_code: '00', op_msg: '' },
            order: this.eventOrder(open),
            contract: { code: open.key.code },
            status: { status: 'Filled' },
            code: open.key.code,
            price,
            quantity,
            action: trade.order.action,
        });
    }

    private applyFill(open: OpenOrder, price: number, quantity: number): void {
        const { action } = open.trade.order;
        const code = open.key.code;
        if (open.accountType === 'S') {
            const pos = this.stockLedger.get(code) ?? {
                code,
                quantity: 0,
                avgPrice: 0,
                ydQuantity: 0,
            };
            const fee = Math.max(20, Math.round(price * quantity * 1000 * 0.001425));
            this.fees += fee;
            if (action === 'Buy') {
                const cost = pos.avgPrice * pos.quantity + price * quantity;
                pos.quantity += quantity;
                pos.avgPrice = pos.quantity > 0 ? cost / pos.quantity : 0;
                this.cash -= price * quantity * 1000 + fee;
            } else {
                const closing = Math.min(quantity, pos.quantity);
                this.realizedToday.S +=
                    (price - pos.avgPrice) * closing * 1000;
                pos.quantity -= quantity;
                if (pos.quantity <= 0) {
                    pos.quantity = Math.max(0, pos.quantity);
                    if (pos.quantity === 0) pos.avgPrice = 0;
                }
                this.cash += price * quantity * 1000 - fee;
            }
            if (pos.quantity === 0) this.stockLedger.delete(code);
            else this.stockLedger.set(code, pos);
        } else {
            const mult = futMultiplier(code);
            const pos = this.futLedger.get(code) ?? {
                code,
                quantity: 0,
                avgPrice: 0,
                ydQuantity: 0,
            };
            const signed = action === 'Buy' ? quantity : -quantity;
            if (pos.quantity === 0 || Math.sign(pos.quantity) === Math.sign(signed)) {
                const cost =
                    pos.avgPrice * Math.abs(pos.quantity) + price * quantity;
                pos.quantity += signed;
                pos.avgPrice = cost / Math.abs(pos.quantity);
            } else {
                const closing = Math.min(quantity, Math.abs(pos.quantity));
                const dir = Math.sign(pos.quantity);
                this.realizedToday.F +=
                    (price - pos.avgPrice) * closing * mult * dir;
                this.futEquity +=
                    (price - pos.avgPrice) * closing * mult * dir;
                pos.quantity += signed;
                if (Math.sign(pos.quantity) === Math.sign(signed) && pos.quantity !== 0) {
                    pos.avgPrice = price; // flipped through zero
                }
            }
            if (pos.quantity === 0) this.futLedger.delete(code);
            else this.futLedger.set(code, pos);
        }
    }

    // ---- TradingProvider API ----

    async placeStockOrder(
        key: ContractKey,
        order: StockOrderReq,
    ): Promise<Trade> {
        const trade = this.buildTrade(key, 'S', order.action, order.price, order.quantity, {
            order_type: order.order_type,
            price_type: order.price_type,
            order_lot: order.order_lot ?? 'Common',
        });
        const open: OpenOrder = {
            tradeId: trade.order.id,
            accountType: 'S',
            key,
            trade,
            limitPrice: order.price_type === 'MKT' ? null : order.price,
            walkHeld: false,
        };
        this.orders.set(open.tradeId, open);
        this.submit(open);
        return trade;
    }

    async placeFuturesOrder(
        key: ContractKey,
        order: FuturesOrderReq,
    ): Promise<Trade> {
        const trade = this.buildTrade(key, 'F', order.action, order.price, order.quantity, {
            order_type: order.order_type,
            price_type: order.price_type,
            octype: order.octype ?? 'Auto',
        });
        const open: OpenOrder = {
            tradeId: trade.order.id,
            accountType: 'F',
            key,
            trade,
            limitPrice: order.price_type === 'LMT' ? order.price : null,
            walkHeld: false,
        };
        this.orders.set(open.tradeId, open);
        this.submit(open);
        return trade;
    }

    private getOpen(tradeId: string): OpenOrder {
        const open = this.orders.get(tradeId);
        if (!open) throw new TradeNotFoundError(tradeId);
        return open;
    }

    async cancel(tradeId: string): Promise<Trade> {
        const open = this.getOpen(tradeId);
        const { status } = open.trade;
        if (status.status === 'Submitted' || status.status === 'PendingSubmit' || status.status === 'PartFilled') {
            status.cancel_quantity =
                status.order_quantity - status.deal_quantity;
            status.status = 'Cancelled';
            this.releaseWalk(open);
            this.emit({
                operation: { op_type: 'Cancel', op_code: '00', op_msg: '' },
                order: this.eventOrder(open),
                contract: { code: open.key.code },
                status: { status: 'Cancelled' },
            });
        }
        return open.trade;
    }

    async updatePrice(tradeId: string, price: number): Promise<Trade> {
        const open = this.getOpen(tradeId);
        if (open.trade.status.status === 'Submitted' && open.limitPrice !== null) {
            open.limitPrice = price;
            open.trade.order.price = price;
            open.trade.status.modified_price = price;
            this.emit({
                operation: { op_type: 'UpdatePrice', op_code: '00', op_msg: '' },
                order: this.eventOrder(open),
                contract: { code: open.key.code },
                status: { status: open.trade.status.status },
            });
            const last = this.feed.lastPrice(open.key.code);
            if (last !== undefined) {
                this.checkLimitFills(open.key.code, last);
            }
        }
        return open.trade;
    }

    async updateQty(tradeId: string, quantity: number): Promise<Trade> {
        const open = this.getOpen(tradeId);
        const { status } = open.trade;
        if (status.status === 'Submitted' && quantity > 0 && quantity < status.order_quantity) {
            status.cancel_quantity += status.order_quantity - quantity;
            status.order_quantity = quantity;
            open.trade.order.quantity = quantity;
            this.emit({
                operation: { op_type: 'UpdateQty', op_code: '00', op_msg: '' },
                order: this.eventOrder(open),
                contract: { code: open.key.code },
                status: { status: status.status },
            });
        }
        return open.trade;
    }

    async trades(accountType: AccountTypeName): Promise<Trade[]> {
        return [...this.orders.values()]
            .filter((o) => o.accountType === accountType)
            .map((o) => o.trade);
    }

    async positions(accountType: AccountTypeName): Promise<Position[]> {
        if (accountType === 'S') {
            return [...this.stockLedger.values()].map((pos, i) => {
                const last = this.feed.lastPrice(pos.code) ?? pos.avgPrice;
                return {
                    id: i,
                    code: pos.code,
                    direction: 'Buy' as Action,
                    quantity: pos.quantity,
                    price: Math.round(pos.avgPrice * 100) / 100,
                    last_price: last,
                    pnl: Math.round((last - pos.avgPrice) * pos.quantity * 1000),
                    yd_quantity: pos.ydQuantity,
                };
            });
        }
        return [...this.futLedger.values()].map((pos, i) => {
            const last = this.feed.lastPrice(pos.code) ?? pos.avgPrice;
            const mult = futMultiplier(pos.code);
            const dir = Math.sign(pos.quantity);
            return {
                id: i,
                code: pos.code,
                direction: (dir >= 0 ? 'Buy' : 'Sell') as Action,
                quantity: Math.abs(pos.quantity),
                price: Math.round(pos.avgPrice * 100) / 100,
                last_price: last,
                pnl: Math.round(
                    (last - pos.avgPrice) * Math.abs(pos.quantity) * mult * dir,
                ),
            };
        });
    }

    async accountBalance(): Promise<AccountBalance> {
        return {
            acc_balance: Math.round(this.cash),
            date: dateStr(new Date()),
            errmsg: '',
        };
    }

    async margin(): Promise<Margin> {
        let initialMargin = 0;
        let unrealized = 0;
        let openLots = 0;
        for (const pos of this.futLedger.values()) {
            const mult = futMultiplier(pos.code);
            const last = this.feed.lastPrice(pos.code) ?? pos.avgPrice;
            initialMargin += marginPerLot(pos.code) * Math.abs(pos.quantity);
            unrealized +=
                (last - pos.avgPrice) * Math.abs(pos.quantity) * mult * Math.sign(pos.quantity);
            openLots += Math.abs(pos.quantity);
        }
        const equity = this.futEquity + unrealized;
        const maintenance = Math.round(initialMargin * 0.75);
        return {
            ...zeroMargin(),
            yesterday_balance: INITIAL_FUT_EQUITY,
            today_balance: Math.round(this.futEquity),
            initial_margin: initialMargin,
            maintenance_margin: maintenance,
            risk_indicator:
                initialMargin > 0
                    ? Math.round((equity / initialMargin) * 100)
                    : 999,
            equity: Math.round(equity),
            equity_amount: Math.round(equity),
            future_open_position: openLots,
            today_future_open_position: openLots,
            future_settle_profitloss: Math.round(this.realizedToday.F),
            available_margin: Math.round(equity - initialMargin),
        };
    }

    async profitLoss(
        beginDate: string,
        endDate: string,
        accountType: AccountTypeName,
    ): Promise<PnlRow[]> {
        if (accountType === 'F') {
            return [
                { date: dateStr(new Date()), pnl: Math.round(this.realizedToday.F) },
            ];
        }
        const rows: PnlRow[] = [];
        const cur = new Date(`${beginDate}T00:00:00`);
        const stop = new Date(`${endDate}T00:00:00`);
        const today = dateStr(new Date());
        if (Number.isNaN(cur.getTime()) || Number.isNaN(stop.getTime())) {
            return rows;
        }
        while (cur <= stop) {
            const day = cur.getDay();
            const ds = dateStr(cur);
            if (day !== 0 && day !== 6 && ds !== today) {
                const rand = mulberry32(hashStr(`pnl:${ds}`));
                rows.push({ date: ds, pnl: Math.round((rand() - 0.45) * 30000) });
            }
            cur.setDate(cur.getDate() + 1);
        }
        rows.push({ date: today, pnl: Math.round(this.realizedToday.S) });
        return rows;
    }
}
