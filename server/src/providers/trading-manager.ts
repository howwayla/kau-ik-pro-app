// server/src/providers/trading-manager.ts — hot-swappable trading front.
//
// Mirrors MarketManager: routes and the SSE hub talk to this manager; the
// manager delegates to the active provider (mock / fubon / nova) and can
// swap providers at runtime when the user picks a broker in the dashboard.
// Order-event forwarding is re-registered on swap so events from a stale
// provider are dropped.

import type { TradeProviderName } from '../config.ts';
import type {
    Account,
    AccountBalance,
    AccountTypeName,
    FuturesOrderReq,
    Margin,
    OrderEventData,
    PnlRow,
    Position,
    StockOrderReq,
    Trade,
} from '../types/dto.ts';
import type { ContractKey, MarketClientSource } from './market-data.ts';
import type { TradingCapabilities, TradingProvider } from './trading.ts';

// broker account APIs are aggressively rate-limited (fubon 「業務系統流量
// 控管」, esun AGR0003/AGR0005) — the UI polls every 10s, so reads go
// through a small TTL cache that serves stale data when the broker
// throttles. Mock skips the cache (paper-trading feedback must be live).
// Freshness is EVENT-DRIVEN, not TTL-driven: the broker report stream
// pushes account-level ACK/MAT events (including orders placed from other
// apps on the same account), and every event busts the relevant caches so
// the next UI poll re-queries. These TTLs are only a reconciliation
// backstop for missed events (e.g. a dropped report websocket).
const READ_TTL_MS = {
    trades: 120_000,
    positions: 180_000,
    balance: 300_000,
    margin: 300_000,
    pnl: 300_000,
} as const;

export class TradingManager implements TradingProvider {
    private active!: TradingProvider;
    private activeName: TradeProviderName = 'mock';
    private eventCbs: ((ev: OrderEventData) => void)[] = [];
    private swapCbs: ((name: TradeProviderName) => void)[] = [];
    private cache = new Map<string, { at: number; value: unknown }>();

    private async cachedRead<T>(
        kind: keyof typeof READ_TTL_MS,
        key: string,
        fn: () => Promise<T>,
    ): Promise<T> {
        if (this.activeName === 'mock') return fn();
        const cacheKey = `${kind}:${key}`;
        const hit = this.cache.get(cacheKey);
        if (hit && Date.now() - hit.at < READ_TTL_MS[kind]) {
            return hit.value as T;
        }
        try {
            const value = await fn();
            this.cache.set(cacheKey, { at: Date.now(), value });
            return value;
        } catch (err) {
            if (hit) return hit.value as T; // throttled — serve stale
            throw err;
        }
    }

    /** manual refresh — drop everything cached */
    bustReadCaches(): void {
        this.cache.clear();
    }

    /** order placement/changes must show up immediately */
    private bustOrderCaches(): void {
        for (const key of this.cache.keys()) {
            if (key.startsWith('trades:') || key.startsWith('positions:')) {
                this.cache.delete(key);
            }
        }
    }

    /** initial provider must already be init()ed */
    start(provider: TradingProvider, name: TradeProviderName): void {
        this.active = provider;
        this.activeName = name;
        this.attach(provider);
    }

    name(): TradeProviderName {
        return this.activeName;
    }

    private attach(provider: TradingProvider): void {
        provider.onOrderEvent((ev) => {
            if (provider !== this.active) return; // stale provider after swap
            // 主動回報 = 帳務狀態變了 → 失效快取，下一次輪詢即時重查。
            // 成交（Deal）會動到持倉/餘額/已實現損益，全部清；
            // 委託回報（新單/刪改）只清委託列表。
            if (ev.operation?.op_type === 'Deal') {
                this.cache.clear();
            } else {
                for (const key of this.cache.keys()) {
                    if (key.startsWith('trades:')) this.cache.delete(key);
                }
            }
            for (const cb of this.eventCbs) cb(ev);
        });
    }

    /** swap to a new (already init()ed) provider */
    swap(provider: TradingProvider, name: TradeProviderName): void {
        const old = this.active;
        this.attach(provider);
        this.active = provider;
        this.activeName = name;
        this.cache.clear();
        try {
            old?.dispose?.();
        } catch {
            // old session may already be dead
        }
        for (const cb of this.swapCbs) cb(name);
    }

    /** notified after the active provider changes (e.g. trigger engine
     *  suspends protective orders that belong to another broker) */
    onSwap(cb: (name: TradeProviderName) => void): void {
        this.swapCbs.push(cb);
    }

    // ---- TradingProvider delegation ----

    async init(): Promise<void> {}

    capabilities(): TradingCapabilities {
        return this.active.capabilities();
    }

    accounts(): Promise<Account[]> {
        return this.active.accounts();
    }

    async placeStockOrder(
        key: ContractKey,
        order: StockOrderReq,
    ): Promise<Trade> {
        const trade = await this.active.placeStockOrder(key, order);
        this.bustOrderCaches();
        return trade;
    }

    async placeFuturesOrder(
        key: ContractKey,
        order: FuturesOrderReq,
    ): Promise<Trade> {
        const trade = await this.active.placeFuturesOrder(key, order);
        this.bustOrderCaches();
        return trade;
    }

    async cancel(tradeId: string): Promise<Trade> {
        const trade = await this.active.cancel(tradeId);
        this.bustOrderCaches();
        return trade;
    }

    async updatePrice(tradeId: string, price: number): Promise<Trade> {
        const trade = await this.active.updatePrice(tradeId, price);
        this.bustOrderCaches();
        return trade;
    }

    async updateQty(tradeId: string, quantity: number): Promise<Trade> {
        const trade = await this.active.updateQty(tradeId, quantity);
        this.bustOrderCaches();
        return trade;
    }

    trades(accountType: AccountTypeName): Promise<Trade[]> {
        return this.cachedRead('trades', accountType, () =>
            this.active.trades(accountType),
        );
    }

    positions(accountType: AccountTypeName): Promise<Position[]> {
        return this.cachedRead('positions', accountType, () =>
            this.active.positions(accountType),
        );
    }

    accountBalance(): Promise<AccountBalance> {
        return this.cachedRead('balance', 'S', () =>
            this.active.accountBalance(),
        );
    }

    margin(): Promise<Margin> {
        return this.cachedRead('margin', 'F', () => this.active.margin());
    }

    profitLoss(
        beginDate: string,
        endDate: string,
        accountType: AccountTypeName,
    ): Promise<PnlRow[]> {
        return this.cachedRead(
            'pnl',
            `${beginDate}:${endDate}:${accountType}`,
            () => this.active.profitLoss(beginDate, endDate, accountType),
        );
    }

    onOrderEvent(cb: (ev: OrderEventData) => void): void {
        this.eventCbs.push(cb);
    }

    marketdataSource(): MarketClientSource | null {
        return this.active.marketdataSource?.() ?? null;
    }
}
