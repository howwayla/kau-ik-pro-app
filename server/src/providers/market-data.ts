// server/src/providers/market-data.ts — market data provider contract.

import type {
    ContractInfo,
    CreditEnquire,
    HistoryTicks,
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

export interface ContractKey {
    security_type: SecurityType;
    exchange: string | null;
    code: string;
}

/**
 * Where the fugle-style market-data clients come from. A plain string is a
 * Fugle API key; broker SDKs (fubon-neo / taishin-sdk) instead hand out
 * already-authenticated @fugle/marketdata clients after initRealtime() —
 * makeWs() must return a FRESH client so reconnects pick up a new token.
 */
export interface MarketClientSource {
    makeRest(): unknown | Promise<unknown>;
    makeWs(): unknown | Promise<unknown>;
}

export type StreamQuoteType = 'Tick' | 'BidAsk';
export type TickChannel = 'tick_stk' | 'tick_fop';
export type BidAskChannel = 'bidask_stk' | 'bidask_fop';

export interface MarketDataProvider {
    init(): Promise<void>;
    contractCount(): number;

    /** null → route answers 404 (frontend relies on STK→FUT fallback) */
    resolveContract(
        code: string,
        type: SecurityType,
    ): Promise<ContractInfo | null>;
    listOptionContracts(): Promise<OptContract[]>;

    snapshots(keys: ContractKey[]): Promise<Snapshot[]>;
    kbars(key: ContractKey, start: string, end: string): Promise<KBars>;
    ticks(
        key: ContractKey,
        date: string,
        lastCount?: number,
    ): Promise<HistoryTicks>;
    /** 官方分價量表（全日）；不支援的商品/來源回空陣列 */
    volumes(key: ContractKey): Promise<VolumeLevel[]>;
    scanner(
        type: ScannerType,
        count: number,
        ascending: boolean,
    ): Promise<ScannerItem[]>;

    creditEnquire(keys: ContractKey[]): Promise<CreditEnquire[]>;
    shortStockSources(keys: ContractKey[]): Promise<ShortSource[]>;
    /** code = 處置 list (legacy field name), attention = 注意 list */
    regulatoryPunish(): Promise<{ code: string[]; attention: string[] }>;

    /** idempotent — duplicate subscribes are no-ops */
    subscribe(key: ContractKey, quote: StreamQuoteType): Promise<void>;
    unsubscribe(key: ContractKey, quote: StreamQuoteType): Promise<void>;
    onTick(cb: (channel: TickChannel, tick: SseTick) => void): void;
    onBidAsk(cb: (channel: BidAskChannel, bidask: SseBidAsk) => void): void;

    /** last traded price from the live cache (used by paper trading) */
    lastPrice(code: string): number | undefined;
    /** display name from the contract cache, if known */
    displayName(code: string): string | undefined;
    /** continuous-month alias resolution (TXFR1 → actual contract code) */
    aliasTarget(code: string): string | undefined;
    /** live-feed health — 'poll' means WS is down and trigger precision
     *  degrades to the REST cache TTL (~10s) */
    feedHealth?(): 'ws' | 'poll' | 'mock';
    /** release timers / sockets when the provider is swapped out */
    dispose(): void;
}

export function tickChannelFor(key: ContractKey): TickChannel {
    return key.security_type === 'FUT' || key.security_type === 'OPT'
        ? 'tick_fop'
        : 'tick_stk';
}

export function bidaskChannelFor(key: ContractKey): BidAskChannel {
    return key.security_type === 'FUT' || key.security_type === 'OPT'
        ? 'bidask_fop'
        : 'bidask_stk';
}
