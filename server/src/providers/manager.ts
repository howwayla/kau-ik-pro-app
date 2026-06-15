// server/src/providers/manager.ts — hot-swappable market-data front.
//
// The app (routes, SSE hub, paper trading) talks to this manager; the
// manager delegates to the active provider (mock or fugle) and can swap
// providers at runtime when the user saves an API key: it re-registers
// event forwarding, replays every active subscription and price hold on
// the new provider, then disposes the old one. The frontend's SSE
// connection never drops during a swap.

import type {
    ContractInfo,
    CreditEnquire,
    HistoryTicks,
    MarketSession,
    VolumeLevel,
    KBars,
    OptContract,
    ScannerItem,
    ScannerType,
    SecurityType,
    ShortSource,
    Snapshot,
    SseBidAsk,
    SseTick,
} from '../types/dto.ts';
import type {
    BidAskChannel,
    ContractKey,
    DailyClose,
    MarketDataProvider,
    StreamQuoteType,
    TickChannel,
} from './market-data.ts';

/** fubon/nova/esun = the broker SDK's bundled market-data feed */
export type MarketName = 'mock' | 'fugle' | 'fubon' | 'nova' | 'esun';

/** what paper trading needs from the market side */
export interface PriceFeed {
    lastPrice(code: string): number | undefined;
    fetchPrice(key: ContractKey): Promise<number | undefined>;
    onPrice(cb: (code: string, price: number) => void): void;
    /** keep prices flowing for a resting order's instrument */
    hold(key: ContractKey): void;
    release(key: ContractKey): void;
    displayName(code: string): string | undefined;
    aliasTarget(code: string): string | undefined;
}

interface SubEntry {
    key: ContractKey;
    quote: StreamQuoteType;
}

export class MarketManager implements MarketDataProvider, PriceFeed {
    private active!: MarketDataProvider;
    private activeName: MarketName = 'mock';

    private subs = new Map<string, SubEntry>();
    private holds = new Map<string, { key: ContractKey; count: number }>();

    private tickCbs: ((ch: TickChannel, t: SseTick) => void)[] = [];
    private bidaskCbs: ((ch: BidAskChannel, b: SseBidAsk) => void)[] = [];
    private priceCbs: ((code: string, price: number) => void)[] = [];

    start(provider: MarketDataProvider, name: MarketName): void {
        this.active = provider;
        this.activeName = name;
        this.attach(provider);
    }

    name(): MarketName {
        return this.activeName;
    }

    /** trigger-engine precision signal: 'mock' | 'ws' | 'poll' */
    feedHealth(): 'ws' | 'poll' | 'mock' {
        if (this.activeName === 'mock') return 'mock';
        return this.active.feedHealth?.() ?? 'ws';
    }

    private marketSwapCbs: ((name: MarketName) => void)[] = [];

    /** notified after the market source changes — price bases differ
     *  between sources, so price-watching consumers must re-baseline */
    onSourceSwap(cb: (name: MarketName) => void): void {
        this.marketSwapCbs.push(cb);
    }

    private attach(provider: MarketDataProvider): void {
        provider.onTick((ch, tick) => {
            if (provider !== this.active) return; // stale provider during swap
            for (const cb of this.tickCbs) cb(ch, tick);
            const price = Number(tick.close);
            if (Number.isFinite(price) && price > 0 && !tick.simtrade) {
                for (const cb of this.priceCbs) cb(tick.code, price);
            }
        });
        provider.onBidAsk((ch, bidask) => {
            if (provider !== this.active) return;
            for (const cb of this.bidaskCbs) cb(ch, bidask);
        });
    }

    /** swap to a new (already init()ed) provider, replaying subscriptions */
    async swap(provider: MarketDataProvider, name: MarketName): Promise<void> {
        const old = this.active;
        this.attach(provider);
        for (const entry of this.subs.values()) {
            try {
                await provider.subscribe(entry.key, entry.quote);
            } catch {
                // tier limits etc. — quotes for this symbol just stay quiet
            }
        }
        for (const hold of this.holds.values()) {
            try {
                await provider.subscribe(hold.key, 'Tick');
            } catch {
                /* same */
            }
        }
        this.active = provider;
        this.activeName = name;
        old.dispose();
        for (const cb of this.marketSwapCbs) cb(name);
    }

    // ---- MarketDataProvider delegation ----

    async init(): Promise<void> {}

    dispose(): void {
        this.active.dispose();
    }

    contractCount(): number {
        return this.active.contractCount();
    }

    resolveContract(
        code: string,
        type: SecurityType,
    ): Promise<ContractInfo | null> {
        return this.active.resolveContract(code, type);
    }

    listOptionContracts(): Promise<OptContract[]> {
        return this.active.listOptionContracts();
    }

    snapshots(keys: ContractKey[]): Promise<Snapshot[]> {
        return this.active.snapshots(keys);
    }

    kbars(
        key: ContractKey,
        start: string,
        end: string,
        session?: MarketSession,
    ): Promise<KBars> {
        return this.active.kbars(key, start, end, session);
    }

    /**
     * 還原日收盤 — 來源沒實作（mock）時退回 kbars：把查詢窗拉寬到
     * 100 天以上讓 kbars 走日 K timeframe，再裁回 [start, end]。
     * fallback 為未還原價，配息會以缺口呈現。
     */
    async dailyCloses(
        key: ContractKey,
        start: string,
        end: string,
    ): Promise<DailyClose[]> {
        if (this.active.dailyCloses) {
            return this.active.dailyCloses(key, start, end);
        }
        const endMs = new Date(end).getTime();
        const wideStart = new Date(Math.min(new Date(start).getTime(), endMs - 110 * 86_400_000))
            .toISOString()
            .slice(0, 10);
        const kb = await this.active.kbars(key, wideStart, end);
        const out: DailyClose[] = [];
        for (let i = 0; i < kb.datetime.length; i += 1) {
            const date = (kb.datetime[i] ?? '').slice(0, 10);
            if (!date || date < start || date > end) continue;
            const close = kb.Close[i];
            if (close === undefined || !Number.isFinite(close) || close <= 0) {
                continue;
            }
            const prev = out[out.length - 1];
            // 同日多根（保險）→ 留最後一根
            if (prev && prev.date === date) prev.close = close;
            else out.push({ date, close });
        }
        return out;
    }

    ticks(
        key: ContractKey,
        date: string,
        lastCount?: number,
    ): Promise<HistoryTicks> {
        return this.active.ticks(key, date, lastCount);
    }

    volumes(key: ContractKey): Promise<VolumeLevel[]> {
        return this.active.volumes(key);
    }

    scanner(
        type: ScannerType,
        count: number,
        ascending: boolean,
    ): Promise<ScannerItem[]> {
        return this.active.scanner(type, count, ascending);
    }

    creditEnquire(keys: ContractKey[]): Promise<CreditEnquire[]> {
        return this.active.creditEnquire(keys);
    }

    shortStockSources(keys: ContractKey[]): Promise<ShortSource[]> {
        return this.active.shortStockSources(keys);
    }

    regulatoryPunish(): Promise<{ code: string[]; attention: string[] }> {
        return this.active.regulatoryPunish();
    }

    async subscribe(key: ContractKey, quote: StreamQuoteType): Promise<void> {
        this.subs.set(`${key.code}:${quote}`, { key, quote });
        await this.active.subscribe(key, quote);
    }

    async unsubscribe(key: ContractKey, quote: StreamQuoteType): Promise<void> {
        this.subs.delete(`${key.code}:${quote}`);
        await this.active.unsubscribe(key, quote);
    }

    onTick(cb: (channel: TickChannel, tick: SseTick) => void): void {
        this.tickCbs.push(cb);
    }

    onBidAsk(cb: (channel: BidAskChannel, bidask: SseBidAsk) => void): void {
        this.bidaskCbs.push(cb);
    }

    lastPrice(code: string): number | undefined {
        return this.active.lastPrice(code);
    }

    displayName(code: string): string | undefined {
        return this.active.displayName(code);
    }

    aliasTarget(code: string): string | undefined {
        return this.active.aliasTarget(code);
    }

    // ---- PriceFeed extras ----

    async fetchPrice(key: ContractKey): Promise<number | undefined> {
        const cached = this.active.lastPrice(key.code);
        if (cached) return cached;
        try {
            const snaps = await this.active.snapshots([key]);
            const close = snaps[0]?.close;
            return close && close > 0 ? close : undefined;
        } catch {
            return undefined;
        }
    }

    onPrice(cb: (code: string, price: number) => void): void {
        this.priceCbs.push(cb);
    }

    hold(key: ContractKey): void {
        const entry = this.holds.get(key.code);
        if (entry) {
            entry.count += 1;
            return;
        }
        this.holds.set(key.code, { key, count: 1 });
        void this.active.subscribe(key, 'Tick').catch(() => undefined);
    }

    release(key: ContractKey): void {
        const entry = this.holds.get(key.code);
        if (!entry) return;
        entry.count -= 1;
        if (entry.count <= 0) {
            this.holds.delete(key.code);
            // only drop the provider subscription if the frontend doesn't
            // also subscribe this symbol
            if (!this.subs.has(`${key.code}:Tick`)) {
                void this.active.unsubscribe(key, 'Tick').catch(() => undefined);
            }
        }
    }
}
