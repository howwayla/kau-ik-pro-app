// server/src/providers/fugle/market.ts — real market data via the official
// @fugle/marketdata SDK (REST + WebSocket), keyed by the user's API key.
//
// Design notes:
//  - snapshots are served from a quote cache: WS trades/books keep it hot
//    for subscribed symbols; cold symbols fall back to REST with a TTL
//    (60s for options — the option chain polls ~34 codes every 10s, which
//    would blow the free-tier 60 req/min REST limit otherwise)
//  - minute candles on Fugle cover only the last ~30 days and ignore
//    from/to, so kbars picks a timeframe by range and filters locally
//  - TXFR1/MXFR1 resolve to the nearest-expiry monthly contract via
//    futopt tickers; SSE ticks are emitted under the resolved code and
//    the frontend's registerCodeAlias maps them back for display

/* eslint-disable @typescript-eslint/no-explicit-any */

import type {
    ContractInfo,
    CreditEnquire,
    HistoryTicks,
    KBars,
    MarketSession,
    OptContract,
    VolumeLevel,
    ScannerItem,
    ScannerType,
    SecurityType,
    ShortSource,
    Snapshot,
    SseBidAsk,
    SseTick,
} from '../../types/dto.ts';
import type {
    BidAskChannel,
    ContractKey,
    DailyClose,
    MarketClientSource,
    MarketDataProvider,
    StreamQuoteType,
    TickChannel,
} from '../market-data.ts';
import {
    bidaskFromBooks,
    dayStateFromQuote,
    kbarsFromCandles,
    scannerItemFromRow,
    snapshotFromState,
    splitTime,
    tickFromTrade,
    type DayState,
} from './map.ts';
import { fetchRegulatoryLists } from './regulatory.ts';
import {
    deliveryMonthOf,
    fromFugleSymbol,
    isContinuousAlias,
    aliasPrefix,
    parseTaifexOption,
    toFugleSymbol,
} from './symbols.ts';

const QUOTE_TTL_MS = 10_000;
const OPT_QUOTE_TTL_MS = 60_000;
const TICKERS_TTL_MS = 10 * 60_000;
const WS_CONNECT_TIMEOUT_MS = 10_000;
const REST_TIMEOUT_MS = 10_000;

/** minutes-from-midnight in Asia/Taipei (timezone-safe regardless of host TZ) */
function taipeiMinutes(now: Date): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Taipei',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(now);
    const h =
        Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return h * 60 + m;
}

/**
 * 期貨/選擇權現在是否該看夜盤（盤後）行情。
 * 台指夜盤 15:00–次日 05:00；空窗期以「最近收盤的那一盤」為準：
 *   08:45–13:45 日盤(live) / 13:45–15:00 取日盤收盤 → 日盤
 *   15:00–05:00 夜盤(live) / 05:00–08:45 取夜盤收盤 → 夜盤
 * 週末無夜盤，API 會回最後一盤資料，這裡不特別處理。
 */
function isAfterHoursNow(now = new Date()): boolean {
    const min = taipeiMinutes(now);
    return min >= 15 * 60 || min < 8 * 60 + 45;
}

// the SDK's ws.connect() promise only settles on (un)authenticated events —
// network errors, closes, and unexpected auth replies leave it pending
// forever, so every await on it must be bounded
function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(msg)), ms);
        p.then(
            (v) => {
                clearTimeout(timer);
                resolve(v);
            },
            (err) => {
                clearTimeout(timer);
                reject(
                    err instanceof Error
                        ? err
                        : new Error(`${msg}: ${JSON.stringify(err).slice(0, 200)}`),
                );
            },
        );
    });
}

// TW tick tables — mirrors src/lib/utils/ticksize.ts on the frontend
function tickFor(code: string, type: SecurityType, price: number): number {
    if (type === 'FUT' || type === 'IND') return 1;
    if (type === 'OPT') return price >= 10 ? 1 : 0.1;
    if (code.startsWith('00')) return price < 50 ? 0.01 : 0.05; // ETF
    if (price < 10) return 0.01;
    if (price < 50) return 0.05;
    if (price < 100) return 0.1;
    if (price < 500) return 0.5;
    if (price < 1000) return 1;
    return 5;
}

/** snap a raw ±10% bound onto the nearest legal tick inside the range */
function limitPrice(
    code: string,
    type: SecurityType,
    raw: number,
    snap: 'up' | 'down',
): number {
    const tick = tickFor(code, type, raw);
    const ticks = snap === 'up' ? Math.ceil(raw / tick - 1e-9) : Math.floor(raw / tick + 1e-9);
    return Number((ticks * tick).toFixed(2));
}

interface CacheEntry {
    state: DayState;
    exchange: string;
    fetchedAt: number;
    /** five-level book from the REST quote — seeds depth panels */
    book?: { bids: unknown[]; asks: unknown[] };
}

export class FugleMarketDataProvider implements MarketDataProvider {
    private rest: any;
    private stockWs: any = null;
    private futoptWs: any = null;
    private sdk: any;

    private quoteCache = new Map<string, CacheEntry>(); // by fugle symbol
    private contractCache = new Map<string, ContractInfo>();
    private optChain: OptContract[] | null = null;
    private optChainAt = 0;
    private optChainAh = false; // 上次抓 optChain 是否夜盤（快取分盤別）
    private futTickers: any[] | null = null;
    private futTickersAt = 0;
    private futTickersAh = false; // 上次抓 futTickers 是否夜盤（快取分盤別）
    private aliasMap = new Map<string, string>(); // TXFR1 → TXFF6

    private subs = new Map<string, Set<StreamQuoteType>>(); // by fugle symbol
    private tickCbs: ((ch: TickChannel, t: SseTick) => void)[] = [];
    private bidaskCbs: ((ch: BidAskChannel, b: SseBidAsk) => void)[] = [];
    private disposed = false;
    private wsFailedUntil = 0; // fail fast instead of re-timing-out per subscribe
    // 期貨/選擇權 WS 連線目前綁的盤別（true=夜盤）；翻盤時要重連換 afterHours
    private futoptAfterHours: boolean | null = null;
    private sessionWatch: ReturnType<typeof setInterval> | null = null;
    // 每條 WS 最後收到封包的時間 — 偵測睡眠後的殭屍連線（連線還在但沒資料）
    private lastWsMsgAt: { stock: number; futopt: number } = {
        stock: 0,
        futopt: 0,
    };

    /** a Fugle API key, or broker-SDK-backed clients (see MarketClientSource) */
    constructor(private source: string | MarketClientSource) {}

    async init(): Promise<void> {
        if (typeof this.source === 'string') {
            if (!this.source) throw new Error('需要 Fugle API Key');
            this.sdk = await import('@fugle/marketdata');
            this.rest = new this.sdk.RestClient({ apiKey: this.source });
        } else {
            this.rest = await this.source.makeRest();
        }
        // validate the credentials with a cheap call
        const probe: any = await withTimeout<any>(
            this.rest.stock.intraday.quote({ symbol: '2330' }),
            REST_TIMEOUT_MS,
            '行情 REST API 連線逾時',
        );
        if (!probe || probe.statusCode === 401 || probe.status === 401) {
            throw new Error('行情授權無效（401）');
        }
        if (probe.statusCode && probe.statusCode >= 400) {
            throw new Error(
                `行情 API 驗證失敗（${probe.statusCode}）: ${probe.message ?? ''}`,
            );
        }
        if (!probe.symbol) {
            throw new Error(
                `行情 API 回應異常: ${JSON.stringify(probe).slice(0, 200)}`,
            );
        }
        // WS 看門狗：①日↔夜交界重連 futopt 換 afterHours；②偵測睡眠後的
        // 殭屍連線（market 開著、有訂閱、卻 >45s 沒收到任何封包）並重連。
        // 後者解決「整夜閒置 → 個股停在 13:30、refresh 無效」（連線還在但
        // 已死、subscribe() 對既有訂閱 early-return 不會重連）。
        const STALE_MS = 45_000;
        this.sessionWatch = setInterval(() => {
            if (this.disposed) return;
            const reconnect = (kind: 'stock' | 'futopt') => {
                const ws = kind === 'stock' ? this.stockWs : this.futoptWs;
                try {
                    ws?.disconnect?.(); // close handler → 3s 後 resubscribe
                } catch {
                    /* already closed */
                }
            };
            // ① futopt 盤別翻轉
            if (
                this.futoptWs &&
                this.futoptAfterHours !== null &&
                isAfterHoursNow() !== this.futoptAfterHours
            ) {
                reconnect('futopt');
                return; // 重連即會刷新時戳，這輪不再判殭屍
            }
            // ② 殭屍連線偵測
            const now = Date.now();
            for (const kind of ['stock', 'futopt'] as const) {
                const ws = kind === 'stock' ? this.stockWs : this.futoptWs;
                if (!ws || !this.hasSubsFor(kind)) continue;
                if (!this.marketOpen(kind)) continue; // 收盤沒資料是正常的
                if (now - this.lastWsMsgAt[kind] > STALE_MS) {
                    console.warn(
                        `行情 WS(${kind}) 疑似殭屍（${Math.round(
                            (now - this.lastWsMsgAt[kind]) / 1000,
                        )}s 無封包）— 重連`,
                    );
                    reconnect(kind);
                }
            }
        }, 20_000);
    }

    dispose(): void {
        this.disposed = true;
        if (this.sessionWatch) {
            clearInterval(this.sessionWatch);
            this.sessionWatch = null;
        }
        try {
            this.stockWs?.disconnect?.();
        } catch { /* already closed */ }
        try {
            this.futoptWs?.disconnect?.();
        } catch { /* already closed */ }
    }

    contractCount(): number {
        return this.contractCache.size + (this.optChain?.length ?? 0);
    }

    feedHealth(): 'ws' | 'poll' {
        // ws marked failed → REST-cache polling only (~10s trigger precision)
        return Date.now() < this.wsFailedUntil ? 'poll' : 'ws';
    }

    // ---- websocket plumbing ----

    private async ensureWs(kind: 'stock' | 'futopt'): Promise<any> {
        const existing = kind === 'stock' ? this.stockWs : this.futoptWs;
        if (existing) return existing;
        if (Date.now() < this.wsFailedUntil) {
            throw new Error('Fugle WebSocket 暫時不可用（稍後自動重試）');
        }
        const client: any =
            typeof this.source === 'string'
                ? new this.sdk.WebSocketClient({ apiKey: this.source })
                : await this.source.makeWs();
        const ws = kind === 'stock' ? client.stock : client.futopt;
        ws.on('message', (raw: any) => {
            this.lastWsMsgAt[kind] = Date.now();
            try {
                const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
                if (process.env.WS_DEBUG) {
                    console.log(
                        '[ws]',
                        kind,
                        msg?.event,
                        msg?.channel ?? '-',
                        JSON.stringify(msg?.data ?? msg ?? {}).slice(0, 100),
                    );
                }
                this.handleWsMessage(kind, msg);
            } catch {
                // malformed frame — ignore
            }
        });
        ws.on('error', () => undefined);
        ws.on('close', () => {
            if (kind === 'stock') this.stockWs = null;
            else this.futoptWs = null;
            if (!this.disposed) {
                setTimeout(() => void this.resubscribe(kind), 3000);
            }
        });
        try {
            await withTimeout(
                ws.connect(),
                WS_CONNECT_TIMEOUT_MS,
                'Fugle WebSocket 認證逾時（方案可能未含即時行情，或網路被阻擋）',
            );
        } catch (err) {
            this.wsFailedUntil = Date.now() + 60_000;
            try {
                ws.disconnect?.();
            } catch {
                /* socket may not exist */
            }
            throw err;
        }
        this.wsFailedUntil = 0;
        this.lastWsMsgAt[kind] = Date.now(); // fresh — don't trip the watchdog
        if (kind === 'stock') this.stockWs = ws;
        else {
            this.futoptWs = ws;
            this.futoptAfterHours = isAfterHoursNow(); // bind this connection's session
        }
        return ws;
    }

    /** 該類商品現在是否在交易時段（殭屍偵測只在「該有資料卻沒資料」時重連） */
    private marketOpen(kind: 'stock' | 'futopt'): boolean {
        const min = taipeiMinutes(new Date());
        if (kind === 'stock') return min >= 9 * 60 && min <= 13 * 60 + 30;
        // futopt 日盤 08:45–13:45、夜盤 15:00–次日 05:00
        return (
            (min >= 8 * 60 + 45 && min <= 13 * 60 + 45) ||
            min >= 15 * 60 ||
            min < 5 * 60
        );
    }

    private hasSubsFor(kind: 'stock' | 'futopt'): boolean {
        for (const symbol of this.subs.keys()) {
            if (this.wsKindFor(symbol) === kind) return true;
        }
        return false;
    }

    /** WS subscribe params; futopt carries the live-session afterHours flag */
    private wsSubParams(symbol: string, channel: 'trades' | 'books') {
        const params: {
            channel: 'trades' | 'books';
            symbol: string;
            afterHours?: boolean;
        } = { channel, symbol };
        if (this.wsKindFor(symbol) === 'futopt' && isAfterHoursNow()) {
            params.afterHours = true;
        }
        return params;
    }

    /** probe WS availability once; lets callers degrade to REST-only mode */
    async probeWebSocket(): Promise<string | null> {
        try {
            await this.ensureWs('stock');
            return null;
        } catch (err) {
            return err instanceof Error ? err.message : String(err);
        }
    }

    private async resubscribe(kind: 'stock' | 'futopt'): Promise<void> {
        try {
            const ws = await this.ensureWs(kind);
            for (const [symbol, quotes] of this.subs) {
                if (this.wsKindFor(symbol) !== kind) continue;
                if (quotes.has('Tick')) {
                    ws.subscribe(this.wsSubParams(symbol, 'trades'));
                }
                if (quotes.has('BidAsk')) {
                    ws.subscribe(this.wsSubParams(symbol, 'books'));
                }
            }
        } catch {
            if (!this.disposed) {
                setTimeout(() => void this.resubscribe(kind), 5000);
            }
        }
    }

    private wsKindFor(symbol: string): 'stock' | 'futopt' {
        return /^(TXF|MXF|TMF|TXO|EXF|FXF|ZF|MX)/.test(symbol) &&
            !/^\d/.test(symbol)
            ? 'futopt'
            : 'stock';
    }

    private channelFor(symbol: string): {
        tick: TickChannel;
        bidask: BidAskChannel;
    } {
        return this.wsKindFor(symbol) === 'futopt'
            ? { tick: 'tick_fop', bidask: 'bidask_fop' }
            : { tick: 'tick_stk', bidask: 'bidask_stk' };
    }

    private handleWsMessage(_kind: 'stock' | 'futopt', msg: any): void {
        // 'snapshot' arrives once right after subscribing (also after the
        // close) — treat it like a data frame so depth/tape panels seed
        // immediately instead of waiting for the next live update
        if ((msg?.event !== 'data' && msg?.event !== 'snapshot') || !msg.data)
            return;
        const data = msg.data;
        const symbol = String(data.symbol ?? '');
        if (!symbol) return;
        const channels = this.channelFor(symbol);
        // snapshot frames may omit `channel` — books carry bids/asks arrays
        const channel =
            msg.channel ??
            (Array.isArray(data.bids) && Array.isArray(data.asks)
                ? 'books'
                : 'trades');
        if (channel === 'trades') {
            const entry = this.quoteCache.get(symbol);
            const state = entry?.state ?? dayStateFromQuote({});
            if (!entry) {
                this.quoteCache.set(symbol, {
                    state,
                    exchange: this.wsKindFor(symbol) === 'futopt' ? 'TAIFEX' : 'TSE',
                    fetchedAt: 0, // REST refresh still allowed to fill totals
                });
            }
            const tick = tickFromTrade(symbol, data, state);
            if (!tick) return; // 無可用價格的 frame（如收盤總結）不發送
            const appCode = fromFugleSymbol(symbol);
            if (appCode !== symbol) tick.code = appCode;
            for (const cb of this.tickCbs) cb(channels.tick, tick);
        } else if (channel === 'books') {
            const bidask = bidaskFromBooks(symbol, data);
            const entry = this.quoteCache.get(symbol);
            if (entry) {
                entry.state.bid = Number(data.bids?.[0]?.price) || entry.state.bid;
                entry.state.ask = Number(data.asks?.[0]?.price) || entry.state.ask;
            }
            const appCode = fromFugleSymbol(symbol);
            if (appCode !== symbol) bidask.code = appCode;
            for (const cb of this.bidaskCbs) cb(channels.bidask, bidask);
        }
    }

    // ---- REST quote cache ----

    private async fetchQuote(symbol: string): Promise<CacheEntry | null> {
        const isFutopt = this.wsKindFor(symbol) === 'futopt';
        const ttl = symbol.startsWith('TXO') ? OPT_QUOTE_TTL_MS : QUOTE_TTL_MS;
        const cached = this.quoteCache.get(symbol);
        if (cached && Date.now() - cached.fetchedAt < ttl) return cached;
        // WS-hot entries skip REST refresh entirely
        if (cached && Date.now() - cached.state.lastUpdatedMs < QUOTE_TTL_MS) {
            return cached;
        }
        try {
            const q = isFutopt
                ? await this.rest.futopt.intraday.quote({
                      symbol,
                      ...(isAfterHoursNow() ? { session: 'afterhours' } : {}),
                  })
                : await this.rest.stock.intraday.quote({ symbol });
            if (!q || q.statusCode >= 400 || !q.symbol) return cached ?? null;
            const entry: CacheEntry = {
                state: dayStateFromQuote(q),
                exchange: isFutopt
                    ? 'TAIFEX'
                    : q.market === 'OTC' || q.market === 'TPEx'
                      ? 'OTC'
                      : 'TSE',
                fetchedAt: Date.now(),
                ...(Array.isArray(q.bids) && Array.isArray(q.asks)
                    ? { book: { bids: q.bids, asks: q.asks } }
                    : {}),
            };
            // don't clobber a fresher WS price with a stale REST one
            if (cached && cached.state.lastUpdatedMs > entry.state.lastUpdatedMs) {
                entry.state.last = cached.state.last;
            }
            this.quoteCache.set(symbol, entry);
            return entry;
        } catch {
            return cached ?? null;
        }
    }

    // ---- contracts ----

    private futoptForbiddenWarned = false;

    private warnIfForbidden(res: any): void {
        if (res?.statusCode === 403 && !this.futoptForbiddenWarned) {
            this.futoptForbiddenWarned = true;
            console.warn(
                'Fugle 期權行情回應 403 — 此 API Key 的方案未含期貨/選擇權行情，' +
                    '台指期與選擇權 T 字將無資料（證券行情不受影響）',
            );
        }
    }

    private async futuresTickers(): Promise<any[]> {
        // 夜盤時段「日盤 tickers」回空 → 連續月 alias(TXFR1) 解析不出來、
        // 整條期貨資料鏈斷掉。夜盤必須帶 session:'AFTERHOURS'。快取分盤別。
        const ah = isAfterHoursNow();
        if (
            this.futTickers &&
            this.futTickersAh === ah &&
            Date.now() - this.futTickersAt < TICKERS_TTL_MS
        ) {
            return this.futTickers;
        }
        const res = await this.rest.futopt.intraday.tickers({
            type: 'FUTURE',
            ...(ah ? { session: 'AFTERHOURS' } : {}),
        });
        this.warnIfForbidden(res);
        this.futTickers = Array.isArray(res?.data) ? res.data : [];
        this.futTickersAt = Date.now();
        this.futTickersAh = ah;
        return this.futTickers!;
    }

    /** nearest-expiry monthly contract for a continuous alias like TXFR1 */
    private async resolveAlias(code: string): Promise<string | null> {
        const hit = this.aliasMap.get(code);
        if (hit) return hit;
        const prefix = aliasPrefix(code); // TXF / MXF
        const tickers = await this.futuresTickers();
        const candidates = tickers
            .map((t: any) => String(t.symbol ?? ''))
            .filter((s: string) => new RegExp(`^${prefix}[A-L]\\d$`).test(s));
        if (candidates.length === 0) return null;
        // sort by delivery month and take the nearest non-expired
        const now = new Date();
        const scored = candidates
            .map((s: string) => {
                const letter = s.charCodeAt(3) - 64;
                const month = deliveryMonthOf(letter, Number(s[4]), now);
                return { s, month };
            })
            .sort((a, b) => a.month.localeCompare(b.month));
        const current = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
        const front = scored.find((x) => x.month >= current) ?? scored[0]!;
        this.aliasMap.set(code, front.s);
        return front.s;
    }

    aliasTarget(code: string): string | undefined {
        return this.aliasMap.get(code);
    }

    async resolveContract(
        code: string,
        type: SecurityType,
    ): Promise<ContractInfo | null> {
        const cacheKey = `${code}:${type}`;
        const cached = this.contractCache.get(cacheKey);
        if (cached) return cached;

        let info: ContractInfo | null = null;
        if (type === 'IND') {
            const entry = await this.fetchQuote(toFugleSymbol(code));
            if (entry) {
                info = this.contractInfo(code, 'IND', entry.exchange, entry.state);
            }
        } else if (type === 'STK') {
            if (/^[A-Z]/.test(code)) return null; // futures-style code — let FUT fallback handle it
            const entry = await this.fetchQuote(code);
            if (entry) {
                info = this.contractInfo(code, 'STK', entry.exchange, entry.state);
            }
        } else if (type === 'FUT') {
            const actual = isContinuousAlias(code)
                ? await this.resolveAlias(code)
                : code;
            if (!actual) return null;
            const entry = await this.fetchQuote(actual);
            if (entry) {
                info = this.contractInfo(code, 'FUT', 'TAIFEX', entry.state);
                info.target_code = actual !== code ? actual : null;
                info.category = aliasPrefix(actual);
            }
        } else if (type === 'OPT') {
            const chain = await this.listOptionContracts();
            const opt = chain.find((c) => c.code === code);
            if (opt) {
                const entry = await this.fetchQuote(code);
                info = this.contractInfo(
                    code,
                    'OPT',
                    'TAIFEX',
                    entry?.state ?? dayStateFromQuote({}),
                );
                info.category = opt.category;
            }
        }
        if (info) this.contractCache.set(cacheKey, info);
        return info;
    }

    private contractInfo(
        code: string,
        type: SecurityType,
        exchange: string,
        state: DayState,
    ): ContractInfo {
        const ref = state.reference || state.last;
        return {
            exchange: exchange as ContractInfo['exchange'],
            code,
            security_type: type,
            target_code: null,
            name: state.name || code,
            currency: 'TWD',
            // 漲跌停必須落在合法 tick 上（±10% 範圍內最接近的 tick）—
            // 直接四捨五入到小數兩位會產生 30.29 這種不可下單的價格
            limit_up: limitPrice(code, type, ref * 1.1, 'down'),
            limit_down: limitPrice(code, type, ref * 0.9, 'up'),
            reference: ref,
            previous_close: state.prevClose || ref,
            day_trade: type === 'STK' ? 'Yes' : '',
            update_date: new Date().toISOString().slice(0, 10).replace(/-/g, '/'),
            category: '',
            margin_trading_balance: 0,
            short_selling_balance: 0,
        };
    }

    displayName(code: string): string | undefined {
        const entry = this.quoteCache.get(toFugleSymbol(code));
        return entry?.state.name || undefined;
    }

    lastPrice(code: string): number | undefined {
        const symbol = this.aliasMap.get(code) ?? toFugleSymbol(code);
        const last = this.quoteCache.get(symbol)?.state.last;
        return last && last > 0 ? last : undefined;
    }

    async listOptionContracts(): Promise<OptContract[]> {
        // 夜盤同 futuresTickers：日盤 OPTION tickers 回空 → 夜盤帶 AFTERHOURS
        const ah = isAfterHoursNow();
        if (
            this.optChain &&
            this.optChainAh === ah &&
            Date.now() - this.optChainAt < TICKERS_TTL_MS
        ) {
            return this.optChain;
        }
        const res = await this.rest.futopt.intraday.tickers({
            type: 'OPTION',
            ...(ah ? { session: 'AFTERHOURS' } : {}),
        });
        this.warnIfForbidden(res);
        const rows: any[] = Array.isArray(res?.data) ? res.data : [];
        const out: OptContract[] = [];
        for (const row of rows) {
            const symbol = String(row.symbol ?? '');
            if (!symbol.startsWith('TXO')) continue;
            const parsed = parseTaifexOption(symbol);
            if (!parsed) continue;
            const month = deliveryMonthOf(parsed.month, parsed.yearDigit);
            out.push({
                code: symbol,
                exchange: 'TAIFEX',
                security_type: 'OPT',
                category: 'TXO',
                delivery_month: month,
                delivery_date: '',
                strike_price: parsed.strike,
                option_right: parsed.right,
                reference: Number(row.referencePrice) || 0,
            });
        }
        this.optChain = out;
        this.optChainAt = Date.now();
        this.optChainAh = ah;
        return out;
    }

    // ---- market data ----

    async snapshots(keys: ContractKey[]): Promise<Snapshot[]> {
        const out: Snapshot[] = [];
        for (const key of keys) {
            const symbol = isContinuousAlias(key.code)
                ? ((await this.resolveAlias(key.code)) ?? key.code)
                : toFugleSymbol(key.code);
            const entry = await this.fetchQuote(symbol);
            if (entry) {
                out.push(snapshotFromState(key.code, entry.exchange, entry.state));
            }
        }
        return out;
    }

    // long-range (weekly/monthly) charts chunk into many historical
    // requests — cache results so repeat opens don't burn the 60/min
    // historical quota (daily data is static intraday)
    private kbarsCache = new Map<string, { at: number; kbars: KBars }>();

    async kbars(
        key: ContractKey,
        start: string,
        end: string,
        session: MarketSession = 'all',
    ): Promise<KBars> {
        const cacheKey = `${key.code}:${start}:${end}:${session}`;
        const hit = this.kbarsCache.get(cacheKey);
        // 分鐘級（短區間）盤中會持續長新 K 棒 — 快取縮短到 1 分鐘
        const spanDays =
            (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000;
        const ttl = spanDays <= 70 ? 60_000 : 10 * 60_000;
        if (hit && Date.now() - hit.at < ttl) return hit.kbars;
        const out = await this.kbarsUncached(key, start, end, session);
        if (out.datetime.length > 0) {
            if (this.kbarsCache.size > 50) this.kbarsCache.clear();
            this.kbarsCache.set(cacheKey, { at: Date.now(), kbars: out });
        }
        return out;
    }

    // 投組績效比較用：還原權息的日收盤（adjusted=true）。跟 K 線圖的
    // kbars 分開 — 交易畫面要的是市場真實價格，績效比較要的是含息
    // 報酬，混用任一邊都錯（0050 配息會被當成下跌缺口）。
    private dailyClosesCache = new Map<
        string,
        { at: number; rows: DailyClose[] }
    >();

    async dailyCloses(
        key: ContractKey,
        start: string,
        end: string,
    ): Promise<DailyClose[]> {
        const cacheKey = `${key.code}:${start}:${end}`;
        const hit = this.dailyClosesCache.get(cacheKey);
        if (hit && Date.now() - hit.at < 10 * 60_000) return hit.rows;
        // 官方查詢區間一次最長 1 年 — 超過一年的窗口分段抓再串接
        const CHUNK_DAYS = 300;
        const symbol = toFugleSymbol(key.code);
        const endMs = new Date(end).getTime();
        let fromMs = new Date(start).getTime();
        let raw: any[] = [];
        while (fromMs <= endMs) {
            const toMs = Math.min(fromMs + CHUNK_DAYS * 86_400_000, endMs);
            const res = await this.rest.stock.historical.candles({
                symbol,
                timeframe: 'D',
                sort: 'asc',
                adjusted: true,
                from: new Date(fromMs).toISOString().slice(0, 10),
                to: new Date(toMs).toISOString().slice(0, 10),
            });
            raw = raw.concat(res?.data ?? []);
            fromMs = toMs + 86_400_000;
        }
        const rows: DailyClose[] = [];
        for (const row of raw) {
            const close = Number(row.close);
            if (row.date && Number.isFinite(close) && close > 0) {
                rows.push({ date: String(row.date).slice(0, 10), close });
            }
        }
        if (rows.length > 0) {
            if (this.dailyClosesCache.size > 50) {
                this.dailyClosesCache.clear();
            }
            this.dailyClosesCache.set(cacheKey, { at: Date.now(), rows });
        }
        return rows;
    }

    private async kbarsUncached(
        key: ContractKey,
        start: string,
        end: string,
        session: MarketSession = 'all',
    ): Promise<KBars> {
        const symbol = isContinuousAlias(key.code)
            ? ((await this.resolveAlias(key.code)) ?? key.code)
            : toFugleSymbol(key.code);
        const isFutopt = this.wsKindFor(symbol) === 'futopt';
        const rangeDays =
            (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000;

        if (isFutopt) {
            // fugle has no historical futopt candles — intraday (today) only.
            // 日盤=無 session、夜盤=session:afterhours、全=兩段抓回來按時間接續。
            const fetchSession = async (s?: 'afterhours'): Promise<any[]> => {
                const res = await this.rest.futopt.intraday.candles({
                    symbol,
                    ...(s ? { session: s } : {}),
                });
                return res?.data ?? [];
            };
            let rows: any[];
            if (session === 'day') {
                rows = await fetchSession();
            } else if (session === 'afterhours') {
                rows = await fetchSession('afterhours');
            } else {
                const [day, night] = await Promise.all([
                    fetchSession(),
                    fetchSession('afterhours'),
                ]);
                // 同 cycle：日盤(08:45–13:45) → 夜盤(15:00–次日05:00)，
                // 依 date(含時間) 排序接成連續序列
                rows = [...day, ...night].sort((a, b) =>
                    String(a.date).localeCompare(String(b.date)),
                );
            }
            return kbarsFromCandles(rows, false);
        }
        // minute candles ignore from/to and return ~30 days; filter locally
        const timeframe =
            rangeDays <= 5 ? '1' : rangeDays <= 12 ? '5' : rangeDays <= 35 ? '15' : rangeDays <= 70 ? '60' : 'D';
        let raw: any[] = [];
        if (timeframe === 'D') {
            // historical daily candles cap the from/to span at ~1 year per
            // request — chunk long ranges (weekly/monthly charts) and concat
            const CHUNK_DAYS = 300;
            const endMs = new Date(end).getTime();
            // 官方資料下限：個股 2010、指數 2015 — 更早的段不用打
            const floorMs = new Date(
                key.security_type === 'IND' ? '2015-01-01' : '2010-01-01',
            ).getTime();
            let fromMs = Math.max(new Date(start).getTime(), floorMs);
            while (fromMs <= endMs) {
                const toMs = Math.min(
                    fromMs + CHUNK_DAYS * 86_400_000,
                    endMs,
                );
                const res = await this.rest.stock.historical.candles({
                    symbol,
                    timeframe,
                    sort: 'asc',
                    from: new Date(fromMs).toISOString().slice(0, 10),
                    to: new Date(toMs).toISOString().slice(0, 10),
                });
                raw = raw.concat(res?.data ?? []);
                fromMs = toMs + 86_400_000;
            }
        } else {
            const res = await this.rest.stock.historical.candles({
                symbol,
                timeframe,
                sort: 'asc',
            });
            raw = res?.data ?? [];
            // 歷史分K盤後才寫入（今日缺）— 用 intraday candles 補今日。
            // 單位（2026-06-12 同根棒比對驗證）：分K（1/5/15/60）歷史與
            // 盤中 volume 同單位（整股=張、興櫃=股、指數=金額），直接併
            const localToday = new Date()
                .toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
            const histHasToday = raw.some(
                (r: any) => String(r.date ?? '').slice(0, 10) === localToday,
            );
            if (!histHasToday) {
                try {
                    const today = await this.rest.stock.intraday.candles({
                        symbol,
                        timeframe,
                    });
                    raw = raw.concat(today?.data ?? []);
                } catch {
                    // 盤前/假日無今日資料 — 歷史照常
                }
            }
        }
        const rows: any[] = raw.filter((r: any) => {
            const d = String(r.date ?? '').slice(0, 10);
            return d >= start && d <= end;
        });
        const isIndex = key.security_type === 'IND';
        // 股→張只在「日K（歷史日K volume=股）」與「興櫃分K（=股）」需要；
        // 上市櫃分K原生就是張，再除 1000 會把量整片砍成 0
        return kbarsFromCandles(
            rows,
            !isIndex && (timeframe === 'D' || key.exchange === 'OES'),
        );
    }

    async ticks(
        key: ContractKey,
        date: string,
        lastCount?: number,
    ): Promise<HistoryTicks> {
        const out: HistoryTicks = {
            datetime: [],
            close: [],
            volume: [],
            bid_price: [],
            bid_volume: [],
            ask_price: [],
            ask_volume: [],
            tick_type: [],
        };
        const symbol = isContinuousAlias(key.code)
            ? ((await this.resolveAlias(key.code)) ?? key.code)
            : toFugleSymbol(key.code);
        const isFutopt = this.wsKindFor(symbol) === 'futopt';
        // fugle 只服務「當日 intraday」逐筆。股票用台北日期比對（不可用
        // UTC，否則台北半夜會比成前一天 → 整片回空）。期貨/選擇權夜盤跨
        // 午夜、掛在次交易日，intraday 端點本來就只回當下這盤 → 不 gate 日期，
        // session 由 isAfterHoursNow 決定日盤/夜盤。
        if (!isFutopt) {
            const today = new Date().toLocaleDateString('sv-SE', {
                timeZone: 'Asia/Taipei',
            });
            if (date !== today) return out;
        }
        try {
            const res = isFutopt
                ? await this.rest.futopt.intraday.trades({
                      symbol,
                      ...(isAfterHoursNow() ? { session: 'afterhours' } : {}),
                  })
                : await this.rest.stock.intraday.trades({
                      symbol,
                      limit: lastCount ?? 1000,
                  });
            const rows: any[] = (res?.data ?? []).slice().reverse(); // API returns newest first
            for (const row of rows) {
                const { date: d, time } = splitTime(row.time);
                out.datetime.push(`${d} ${time}`);
                out.close.push(Number(row.price) || 0);
                out.volume.push(Number(row.size) || 0);
                out.bid_price.push(Number(row.bid) || 0);
                out.bid_volume.push(0);
                out.ask_price.push(Number(row.ask) || 0);
                out.ask_volume.push(0);
                const price = Number(row.price) || 0;
                out.tick_type.push(
                    row.ask && price >= Number(row.ask)
                        ? 1
                        : row.bid && price <= Number(row.bid)
                          ? 2
                          : 0,
                );
            }
            if (lastCount && out.datetime.length > lastCount) {
                for (const k of Object.keys(out) as (keyof HistoryTicks)[]) {
                    out[k] = out[k].slice(-lastCount) as never;
                }
            }
        } catch {
            // no intraday data (e.g. pre-market) — empty arrays are fine
        }
        return out;
    }

    async scanner(
        type: ScannerType,
        count: number,
        ascending: boolean,
    ): Promise<ScannerItem[]> {
        const markets = ['TSE', 'OTC'];
        let rows: any[] = [];
        try {
            if (type === 'ChangePercentRank' || type === 'ChangePriceRank') {
                const res = await Promise.all(
                    markets.map((market) =>
                        this.rest.stock.snapshot.movers({
                            market,
                            change: type === 'ChangePercentRank' ? 'percent' : 'value',
                            direction: ascending ? 'down' : 'up',
                            type: 'COMMONSTOCK',
                        }),
                    ),
                );
                rows = res.flatMap((r: any) => r?.data ?? []);
                rows.sort((a, b) =>
                    ascending
                        ? Number(a.changePercent ?? a.change) - Number(b.changePercent ?? b.change)
                        : Number(b.changePercent ?? b.change) - Number(a.changePercent ?? a.change),
                );
            } else if (type === 'VolumeRank' || type === 'AmountRank' || type === 'TickCountRank') {
                const trade = type === 'AmountRank' ? 'value' : 'volume';
                const res = await Promise.all(
                    markets.map((market) =>
                        this.rest.stock.snapshot.actives({
                            market,
                            trade,
                            type: 'COMMONSTOCK',
                        }),
                    ),
                );
                rows = res.flatMap((r: any) => r?.data ?? []);
                rows.sort((a, b) =>
                    trade === 'value'
                        ? Number(b.tradeValue) - Number(a.tradeValue)
                        : Number(b.tradeVolume) - Number(a.tradeVolume),
                );
            } else {
                return []; // DayRangeRank not supported by fugle snapshots
            }
        } catch {
            return [];
        }
        return rows.slice(0, count).map((row) =>
            scannerItemFromRow(
                row,
                type === 'AmountRank'
                    ? Number(row.tradeValue) || 0
                    : type === 'VolumeRank'
                      ? Number(row.tradeVolume) || 0
                      : Number(row.changePercent ?? row.change) || 0,
            ),
        );
    }

    /** 官方分價量表（intraday/volumes，全日交易所級）。期貨無內外盤欄位 */
    async volumes(key: ContractKey): Promise<VolumeLevel[]> {
        if (key.security_type === 'IND') return [];
        const symbol = isContinuousAlias(key.code)
            ? ((await this.resolveAlias(key.code)) ?? key.code)
            : toFugleSymbol(key.code);
        const isFutopt = this.wsKindFor(symbol) === 'futopt';
        try {
            const res = isFutopt
                ? await this.rest.futopt.intraday.volumes({
                      symbol,
                      ...(isAfterHoursNow() ? { session: 'afterhours' } : {}),
                  })
                : await this.rest.stock.intraday.volumes({ symbol });
            const rows: any[] = res?.data ?? [];
            return rows
                .map((r) => ({
                    price: Number(r.price) || 0,
                    volume: Number(r.volume) || 0,
                    at_bid: Number(r.volumeAtBid) || 0,
                    at_ask: Number(r.volumeAtAsk) || 0,
                }))
                .filter((r) => r.price > 0 && r.volume > 0);
        } catch {
            return []; // 前端 fallback 用逐筆累計
        }
    }

    // credit/short-source data has no fugle source — frontend handles empty
    async creditEnquire(_keys: ContractKey[]): Promise<CreditEnquire[]> {
        return [];
    }

    async shortStockSources(_keys: ContractKey[]): Promise<ShortSource[]> {
        return [];
    }

    async regulatoryPunish(): Promise<{ code: string[]; attention: string[] }> {
        return fetchRegulatoryLists();
    }

    // ---- subscriptions ----

    async subscribe(key: ContractKey, quote: StreamQuoteType): Promise<void> {
        if (key.security_type === 'IND') return; // index served via REST polling
        const symbol = isContinuousAlias(key.code)
            ? ((await this.resolveAlias(key.code)) ?? key.code)
            : toFugleSymbol(key.code);
        // seed day state so the first WS tick has open/high/low context.
        // 放在重複訂閱檢查「之前」：首次 seed 可能剛好撞上重啟瞬間失敗，
        // 前端重新整理會重發 subscribe — 必須讓它能補 seed（fetchQuote
        // 有 TTL cache，重複呼叫成本低）
        const entry = await this.fetchQuote(symbol);
        // REST quote 已帶最後五檔 — 直接 seed 深度面板，不必等 WS snapshot
        if (quote === 'BidAsk') {
            if (entry?.book) {
                this.pushBookSeed(symbol, entry.book);
            } else {
                // 暫時性失敗（剛重啟、上游瞬斷）：稍後自動補 seed，
                // 不讓深度面板停在空白等用戶重整
                setTimeout(() => {
                    if (!this.subs.get(symbol)?.has('BidAsk')) return;
                    void this.fetchQuote(symbol).then((e) => {
                        if (e?.book) this.pushBookSeed(symbol, e.book);
                    });
                }, 3000);
            }
        }
        let set = this.subs.get(symbol);
        if (!set) {
            set = new Set();
            this.subs.set(symbol, set);
        }
        if (set.has(quote)) return;
        set.add(quote);
        const ws = await this.ensureWs(this.wsKindFor(symbol));
        ws.subscribe(this.wsSubParams(symbol, quote === 'Tick' ? 'trades' : 'books'));
    }

    private pushBookSeed(
        symbol: string,
        book: { bids: unknown[]; asks: unknown[] },
    ): void {
        const bidask = bidaskFromBooks(symbol, {
            bids: book.bids,
            asks: book.asks,
        });
        const appCode = fromFugleSymbol(symbol);
        if (appCode !== symbol) bidask.code = appCode;
        const channels = this.channelFor(symbol);
        for (const cb of this.bidaskCbs) cb(channels.bidask, bidask);
    }

    async unsubscribe(key: ContractKey, quote: StreamQuoteType): Promise<void> {
        const symbol = this.aliasMap.get(key.code) ?? toFugleSymbol(key.code);
        const set = this.subs.get(symbol);
        if (!set?.delete(quote)) return;
        if (set.size === 0) this.subs.delete(symbol);
        const ws = this.wsKindFor(symbol) === 'stock' ? this.stockWs : this.futoptWs;
        ws?.unsubscribe?.({
            channel: quote === 'Tick' ? 'trades' : 'books',
            symbol,
        });
    }

    onTick(cb: (channel: TickChannel, tick: SseTick) => void): void {
        this.tickCbs.push(cb);
    }

    onBidAsk(cb: (channel: BidAskChannel, bidask: SseBidAsk) => void): void {
        this.bidaskCbs.push(cb);
    }
}
