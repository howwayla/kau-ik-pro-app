// server/src/triggers/engine.ts — server-side trigger engine (L2 protection).
//
// Watches the live price feed and fires protective market orders for
// stop/take triggers, arms OCO bracket pairs when entry orders fill, and
// enforces day-expiry. Replaces the old in-browser engine so protection
// survives closed tabs (NOT a dead server — the UI shows engine status).
//
// Crash-safety invariant: a trigger is removed from the persisted store
// BEFORE its order is placed, so a crash mid-fire can never double-fire
// on restart. Restart reconciliation never auto-fires a crossed trigger —
// it suspends it and lets the user decide (rearm / delete).

import { randomUUID } from 'node:crypto';
import type { MarketManager } from '../providers/manager.ts';
import type { TradingManager } from '../providers/trading-manager.ts';
import type { TradeProviderName } from '../config.ts';
import type { SseHub } from '../sse/hub.ts';
import type { Trade } from '../types/dto.ts';
import type { TriggerStore } from './store.ts';
import {
    tradingDayToday,
    type NewBracketInput,
    type NewTriggerInput,
    type PendingBracketRec,
    type ServerTrigger,
    type TriggerEngineStatus,
    type TriggerEvent,
} from './types.ts';

const EXPIRY_SWEEP_MS = 60_000;
const BRACKET_POLL_MS = 5_000;

function isFutures(t: { contract: { security_type: string | null } }): boolean {
    return (
        t.contract.security_type === 'FUT' || t.contract.security_type === 'OPT'
    );
}

function crossed(t: ServerTrigger, price: number): boolean {
    return t.condition === 'below' ? price <= t.price : price >= t.price;
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

export class TriggerEngine {
    private firing = new Set<string>();
    private lastPriceAt: number | null = null;
    private expiryTimer: NodeJS.Timeout | null = null;
    private bracketTimer: NodeJS.Timeout | null = null;

    constructor(
        private market: MarketManager,
        private trading: TradingManager,
        private hub: SseHub,
        private store: TriggerStore,
    ) {}

    private broadcast(ev: TriggerEvent): void {
        this.hub.broadcast('trigger_event', ev);
    }

    // ---- lifecycle ----

    async start(): Promise<void> {
        await this.reconcileTriggers();
        await this.reconcileBrackets();
        this.market.onPrice((code, price) => this.onPrice(code, price));
        this.trading.onOrderEvent((ev) => {
            const isDeal =
                ev.operation?.op_type === 'Deal' || ev.code !== undefined;
            if (isDeal) void this.onDeal(ev);
        });
        this.trading.onSwap((name) => this.handleBrokerSwap(name));
        // SAFETY: market sources have different price bases (e.g. mock walk
        // vs real quotes) — a source switch must never fire real orders
        this.market.onSourceSwap(() => this.handleMarketSwap());
        this.expiryTimer = setInterval(() => this.expirySweep(), EXPIRY_SWEEP_MS);
        this.expiryTimer.unref();
        this.bracketTimer = setInterval(
            () => void this.pollBrackets(),
            BRACKET_POLL_MS,
        );
        this.bracketTimer.unref();
    }

    dispose(): void {
        if (this.expiryTimer) clearInterval(this.expiryTimer);
        if (this.bracketTimer) clearInterval(this.bracketTimer);
    }

    /** restart reconciliation — never auto-fire while-we-were-down crossings */
    private async reconcileTriggers(): Promise<void> {
        for (const t of [...this.store.triggers()]) {
            if (t.state !== 'active') continue;
            let price: number | undefined;
            try {
                price = await this.market.fetchPrice(t.contract);
            } catch {
                price = undefined;
            }
            if (price !== undefined && crossed(t, price)) {
                t.state = 'suspended';
                t.suspendReason = 'crossed_while_down';
                this.store.upsertTrigger(t);
                this.broadcast({
                    type: 'suspended',
                    trigger: t,
                    message: `伺服器離線期間 ${t.code} 已穿越觸發價 ${t.price}（現價 ${price}）— 已暫停，請確認後重新啟用或刪除`,
                });
            } else {
                this.market.hold(t.contract);
            }
        }
    }

    private async reconcileBrackets(): Promise<void> {
        for (const b of [...this.store.brackets()]) {
            try {
                const trades = await this.trading.trades(b.accountType);
                const trade = this.matchTrade(trades, b);
                if (!trade) continue; // keep watching — events/poll will catch up
                const status = trade.status.status;
                if (
                    status === 'Cancelled' ||
                    status === 'Failed' ||
                    status === 'Inactive'
                ) {
                    this.dropBracket(b, `進場單已${status === 'Cancelled' ? '取消' : '失敗'}`);
                } else if (trade.status.deal_quantity > b.armedQty) {
                    const lastDeal =
                        trade.status.deals[trade.status.deals.length - 1];
                    this.armBracket(
                        b,
                        trade.status.deal_quantity,
                        lastDeal?.price ?? trade.order.price,
                    );
                }
            } catch {
                // broker throttled — keep and retry via poll
            }
        }
    }

    // ---- price watching ----

    private onPrice(code: string, price: number): void {
        this.lastPriceAt = Date.now();
        // snapshot: fire() mutates the store mid-iteration
        for (const t of [...this.store.triggers()]) {
            if (t.state !== 'active') continue;
            if (t.code !== code && this.market.aliasTarget(t.code) !== code) {
                continue;
            }
            if (crossed(t, price)) void this.fire(t, price);
        }
    }

    private async fire(t: ServerTrigger, lastPrice: number): Promise<void> {
        if (this.firing.has(t.id)) return;
        this.firing.add(t.id);
        try {
            // OCO sibling may have removed us in this same tick
            const current = this.store.getTrigger(t.id);
            if (!current || current.state !== 'active') return;

            // remove BEFORE placing — crash here loses the trigger, never doubles it
            this.store.removeTrigger(t.id);
            this.market.release(t.contract);
            this.cancelOcoSiblings(t);
            this.broadcast({ type: 'fired', trigger: t, price: lastPrice });

            if (t.kind === 'alert') return;

            if (this.trading.name() !== t.broker) {
                // race window around a broker swap — keep it visible, not fired
                t.state = 'suspended';
                t.suspendReason = 'broker_switched';
                this.store.upsertTrigger(t);
                this.broadcast({
                    type: 'fire_skipped',
                    trigger: t,
                    message: `${t.code} 觸價但目前券商（${this.trading.name()}）非設定時券商（${t.broker}）— 未下單，已暫停`,
                });
                return;
            }
            if (isFutures(t) && !this.trading.capabilities().futures) {
                this.broadcast({
                    type: 'fire_skipped',
                    trigger: t,
                    message: `${t.code} 觸價，但目前券商不支援期權下單 — 僅通知未下單`,
                });
                return;
            }

            try {
                const trade = await this.placeMarketOrder(t);
                this.broadcast({
                    type: 'fired',
                    trigger: t,
                    price: lastPrice,
                    message: `${t.code} @${lastPrice} → 市價${t.action === 'Buy' ? '買' : '賣'} ${t.quantity}（${trade.status.status}）`,
                });
            } catch (err) {
                t.state = 'suspended';
                t.suspendReason = 'fire_failed';
                this.store.upsertTrigger(t);
                this.market.hold(t.contract);
                this.broadcast({
                    type: 'fire_failed',
                    trigger: t,
                    message: `${t.code} 觸價送單失敗：${err instanceof Error ? err.message : String(err)} — 觸價單已暫停，部位目前無保護`,
                });
            }
        } finally {
            this.firing.delete(t.id);
        }
    }

    private placeMarketOrder(t: ServerTrigger): Promise<Trade> {
        // mirrors the frontend's placeQuickOrder market-order shapes
        if (isFutures(t)) {
            return this.trading.placeFuturesOrder(t.contract, {
                action: t.action,
                price: 0,
                quantity: t.quantity,
                price_type: 'MKT',
                order_type: 'IOC',
                octype: 'Auto',
            });
        }
        return this.trading.placeStockOrder(t.contract, {
            action: t.action,
            price: 0,
            quantity: t.quantity,
            price_type: 'MKT',
            order_type: 'IOC',
            order_lot: 'Common',
        });
    }

    private cancelOcoSiblings(t: ServerTrigger): void {
        if (!t.group) return;
        for (const sib of [...this.store.triggers()]) {
            if (sib.group !== t.group || sib.id === t.id) continue;
            this.store.removeTrigger(sib.id);
            if (sib.state === 'active') this.market.release(sib.contract);
            this.broadcast({ type: 'oco_cancelled', trigger: sib, group: t.group });
        }
    }

    // ---- CRUD ----

    list(): ServerTrigger[] {
        return this.store.triggers();
    }

    add(input: NewTriggerInput): ServerTrigger {
        if (input.kind !== 'alert' && input.quantity <= 0) {
            throw new Error('quantity must be positive');
        }
        if (!(input.price > 0)) {
            throw new Error('price must be positive');
        }
        const trigger: ServerTrigger = {
            ...input,
            id: `tg-${randomUUID()}`,
            broker: this.trading.name(),
            expiry: input.expiry ?? 'day',
            createdAt: Date.now(),
            tradingDay: tradingDayToday(),
            state: 'active',
        };
        this.store.upsertTrigger(trigger);
        this.market.hold(trigger.contract);
        this.broadcast({ type: 'added', trigger });
        return trigger;
    }

    update(
        id: string,
        patch: { price?: number; quantity?: number },
    ): ServerTrigger {
        const t = this.store.getTrigger(id);
        if (!t) throw new Error(`trigger not found: ${id}`);
        if (patch.price !== undefined) {
            if (!(patch.price > 0)) throw new Error('price must be positive');
            t.price = patch.price;
        }
        if (patch.quantity !== undefined) {
            if (patch.quantity <= 0) throw new Error('quantity must be positive');
            t.quantity = patch.quantity;
        }
        this.store.upsertTrigger(t);
        this.broadcast({ type: 'updated', trigger: t });
        return t;
    }

    remove(id: string): void {
        const t = this.store.removeTrigger(id);
        if (!t) return;
        if (t.state === 'active') this.market.release(t.contract);
        this.broadcast({ type: 'removed', trigger: t, id });
    }

    /** user re-activates a suspended trigger — if price already crossed it
     *  will fire on the next tick (explicit user decision) */
    rearm(id: string): ServerTrigger {
        const t = this.store.getTrigger(id);
        if (!t) throw new Error(`trigger not found: ${id}`);
        if (t.state === 'suspended') {
            t.state = 'active';
            t.suspendReason = undefined;
            t.broker = this.trading.name();
            this.store.upsertTrigger(t);
            this.market.hold(t.contract);
            this.broadcast({ type: 'rearmed', trigger: t });
        }
        return t;
    }

    importLegacy(
        inputs: NewTriggerInput[],
        legacyBrokers: (string | undefined)[],
    ): { imported: number; dropped: number } {
        let imported = 0;
        let dropped = 0;
        inputs.forEach((input, i) => {
            const legacyBroker = legacyBrokers[i];
            // alerts are broker-independent; protective orders only import
            // when they belong to the currently active broker
            if (
                input.kind !== 'alert' &&
                legacyBroker &&
                legacyBroker !== this.trading.name()
            ) {
                dropped += 1;
                return;
            }
            try {
                this.add({ ...input, expiry: 'gtc' }); // legacy semantics were GTC
                imported += 1;
            } catch {
                dropped += 1;
            }
        });
        this.broadcast({ type: 'imported', imported, dropped });
        return { imported, dropped };
    }

    // ---- brackets ----

    listBrackets(): PendingBracketRec[] {
        return this.store.brackets();
    }

    registerBracket(input: NewBracketInput): PendingBracketRec {
        const rec: PendingBracketRec = {
            ...input,
            id: `bk-${randomUUID()}`,
            broker: this.trading.name(),
            createdAt: Date.now(),
            tradingDay: tradingDayToday(),
            armedQty: 0,
        };
        this.store.upsertBracket(rec);
        this.broadcast({ type: 'added', bracket: rec });
        return rec;
    }

    private matchTrade(
        trades: Trade[],
        b: PendingBracketRec,
    ): Trade | undefined {
        return (
            trades.find((t) => t.order.id === b.tradeId) ??
            (b.ordno
                ? trades.find((t) => t.order.ordno === b.ordno)
                : undefined) ??
            (b.seqno ? trades.find((t) => t.order.seqno === b.seqno) : undefined)
        );
    }

    private matchesBracket(
        b: PendingBracketRec,
        ev: { order?: { id?: string; ordno?: string; seqno?: string } },
    ): boolean {
        const o = ev.order;
        if (!o) return false;
        return (
            (!!o.id && o.id === b.tradeId) ||
            (!!b.ordno && o.ordno === b.ordno) ||
            (!!b.seqno && o.seqno === b.seqno)
        );
    }

    private async onDeal(ev: {
        order?: { id?: string; ordno?: string; seqno?: string; price?: number; quantity?: number };
        price?: number;
        quantity?: number;
    }): Promise<void> {
        for (const b of [...this.store.brackets()]) {
            if (!this.matchesBracket(b, ev)) continue;
            const fillQty = ev.quantity ?? ev.order?.quantity ?? 0;
            const fillPrice = ev.price ?? ev.order?.price ?? 0;
            const newQty = Math.min(b.quantity, b.armedQty + fillQty);
            if (newQty > b.armedQty) this.armBracket(b, newQty, fillPrice);
        }
    }

    private async pollBrackets(): Promise<void> {
        if (this.store.brackets().length === 0) return;
        await this.reconcileBrackets();
    }

    /** first fill arms the OCO pair; later partial fills bump quantities */
    private armBracket(
        b: PendingBracketRec,
        cumulativeQty: number,
        fillPrice: number,
    ): void {
        const delta = cumulativeQty - b.armedQty;
        if (delta <= 0) return;
        const group = `oco-${b.tradeId.slice(0, 10)}`;
        const exit = b.action === 'Buy' ? 'Sell' : 'Buy';
        const sign = b.action === 'Buy' ? 1 : -1;
        const base = fillPrice > 0 ? fillPrice : undefined;
        const stopPrice =
            b.stop ??
            (b.stopOffset !== undefined && base !== undefined
                ? round2(base - sign * b.stopOffset)
                : undefined);
        const takePrice =
            b.take ??
            (b.takeOffset !== undefined && base !== undefined
                ? round2(base + sign * b.takeOffset)
                : undefined);

        if (b.armedQty === 0) {
            if (stopPrice !== undefined && stopPrice > 0) {
                this.add({
                    contract: b.contract,
                    code: b.code,
                    condition: b.action === 'Buy' ? 'below' : 'above',
                    price: stopPrice,
                    action: exit,
                    quantity: delta,
                    kind: 'stop',
                    group,
                    accountType: b.accountType,
                    expiry: b.expiry,
                });
            }
            if (takePrice !== undefined && takePrice > 0) {
                this.add({
                    contract: b.contract,
                    code: b.code,
                    condition: b.action === 'Buy' ? 'above' : 'below',
                    price: takePrice,
                    action: exit,
                    quantity: delta,
                    kind: 'take',
                    group,
                    accountType: b.accountType,
                    expiry: b.expiry,
                });
            }
        } else {
            for (const t of this.store.triggers()) {
                if (t.group === group && t.kind !== 'alert') {
                    t.quantity += delta;
                    this.store.upsertTrigger(t);
                    this.broadcast({ type: 'updated', trigger: t });
                }
            }
        }

        b.armedQty = cumulativeQty;
        if (b.armedQty >= b.quantity) {
            this.store.removeBracket(b.id);
        } else {
            this.store.upsertBracket(b);
        }
        this.broadcast({ type: 'bracket_armed', bracket: b, price: fillPrice });
    }

    private dropBracket(b: PendingBracketRec, reason: string): void {
        this.store.removeBracket(b.id);
        this.broadcast({ type: 'bracket_dropped', bracket: b, message: reason });
    }

    // ---- expiry & broker swap ----

    private expirySweep(): void {
        const today = tradingDayToday();
        for (const t of [...this.store.triggers()]) {
            if (t.expiry === 'day' && t.tradingDay !== today) {
                this.store.removeTrigger(t.id);
                if (t.state === 'active') this.market.release(t.contract);
                this.broadcast({ type: 'expired', trigger: t });
            }
        }
        for (const b of [...this.store.brackets()]) {
            if (b.expiry === 'day' && b.tradingDay !== today) {
                this.dropBracket(b, '當日有效，已過期');
            }
        }
    }

    /** market-source switch: suspend everything that watches prices —
     *  the new source's price basis may differ wildly (mock vs real) */
    handleMarketSwap(): void {
        for (const t of [...this.store.triggers()]) {
            if (t.state !== 'active') continue;
            t.state = 'suspended';
            t.suspendReason = 'market_switched';
            this.store.upsertTrigger(t);
            this.market.release(t.contract);
            this.broadcast({
                type: 'suspended',
                trigger: t,
                message: `行情來源已切換 — ${t.code} 觸價單已暫停（價格基準可能不同，請確認後重新啟用）`,
            });
        }
    }

    handleBrokerSwap(name: TradeProviderName): void {
        for (const t of [...this.store.triggers()]) {
            if (t.kind === 'alert') continue; // alerts are broker-independent
            if (t.broker === name) continue;
            if (t.state !== 'active') continue;
            t.state = 'suspended';
            t.suspendReason = 'broker_switched';
            this.store.upsertTrigger(t);
            this.market.release(t.contract);
            this.broadcast({
                type: 'suspended',
                trigger: t,
                message: `券商已切換至 ${name} — ${t.code} 保護單已暫停（可重新啟用）`,
            });
        }
        for (const b of [...this.store.brackets()]) {
            if (b.broker !== name) {
                this.dropBracket(b, `券商已切換至 ${name}`);
            }
        }
    }

    // ---- status ----

    status(): TriggerEngineStatus {
        const triggers = this.store.triggers();
        const feedMode = this.market.feedHealth();
        return {
            broker: this.trading.name(),
            market: this.market.name(),
            feed_mode: feedMode,
            ...(feedMode === 'poll'
                ? {
                      feed_warning:
                          'WebSocket 降級為 REST 輪詢 — 觸價精度約 10 秒',
                  }
                : {}),
            active: triggers.filter((t) => t.state === 'active').length,
            suspended: triggers.filter((t) => t.state === 'suspended').length,
            pending_brackets: this.store.brackets().length,
            last_price_at: this.lastPriceAt,
        };
    }
}
