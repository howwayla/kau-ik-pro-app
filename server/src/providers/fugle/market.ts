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
    OptContract,
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
    private futTickers: any[] | null = null;
    private futTickersAt = 0;
    private aliasMap = new Map<string, string>(); // TXFR1 → TXFF6

    private subs = new Map<string, Set<StreamQuoteType>>(); // by fugle symbol
    private tickCbs: ((ch: TickChannel, t: SseTick) => void)[] = [];
    private bidaskCbs: ((ch: BidAskChannel, b: SseBidAsk) => void)[] = [];
    private disposed = false;
    private wsFailedUntil = 0; // fail fast instead of re-timing-out per subscribe

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
    }

    dispose(): void {
        this.disposed = true;
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
        if (kind === 'stock') this.stockWs = ws;
        else this.futoptWs = ws;
        return ws;
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
                    ws.subscribe({ channel: 'trades', symbol });
                }
                if (quotes.has('BidAsk')) {
                    ws.subscribe({ channel: 'books', symbol });
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
                ? await this.rest.futopt.intraday.quote({ symbol })
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
        if (this.futTickers && Date.now() - this.futTickersAt < TICKERS_TTL_MS) {
            return this.futTickers;
        }
        const res = await this.rest.futopt.intraday.tickers({ type: 'FUTURE' });
        this.warnIfForbidden(res);
        this.futTickers = Array.isArray(res?.data) ? res.data : [];
        this.futTickersAt = Date.now();
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
                info = this.contractInfo(code, 'IND', 'TSE', entry.state);
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
        if (this.optChain && Date.now() - this.optChainAt < TICKERS_TTL_MS) {
            return this.optChain;
        }
        const res = await this.rest.futopt.intraday.tickers({ type: 'OPTION' });
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

    async kbars(key: ContractKey, start: string, end: string): Promise<KBars> {
        const symbol = isContinuousAlias(key.code)
            ? ((await this.resolveAlias(key.code)) ?? key.code)
            : toFugleSymbol(key.code);
        const isFutopt = this.wsKindFor(symbol) === 'futopt';
        const rangeDays =
            (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000;

        if (isFutopt) {
            // fugle has no historical futopt candles — intraday (today) only
            const res = await this.rest.futopt.intraday.candles({ symbol });
            return kbarsFromCandles(res?.data ?? [], false);
        }
        // minute candles ignore from/to and return ~30 days; filter locally
        const timeframe =
            rangeDays <= 5 ? '1' : rangeDays <= 12 ? '5' : rangeDays <= 35 ? '15' : rangeDays <= 70 ? '60' : 'D';
        const res = await this.rest.stock.historical.candles({
            symbol,
            timeframe,
            sort: 'asc',
            ...(timeframe === 'D' ? { from: start, to: end } : {}),
        });
        const rows: any[] = (res?.data ?? []).filter((r: any) => {
            const d = String(r.date ?? '').slice(0, 10);
            return d >= start && d <= end;
        });
        const isIndex = key.security_type === 'IND';
        return kbarsFromCandles(rows, !isIndex);
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
        const today = new Date().toISOString().slice(0, 10);
        if (date !== today) return out; // fugle serves intraday trades only
        const symbol = isContinuousAlias(key.code)
            ? ((await this.resolveAlias(key.code)) ?? key.code)
            : toFugleSymbol(key.code);
        const isFutopt = this.wsKindFor(symbol) === 'futopt';
        try {
            const res = isFutopt
                ? await this.rest.futopt.intraday.trades({ symbol })
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
        let set = this.subs.get(symbol);
        if (!set) {
            set = new Set();
            this.subs.set(symbol, set);
        }
        if (set.has(quote)) return;
        set.add(quote);
        // seed day state so the first WS tick has open/high/low context
        const entry = await this.fetchQuote(symbol);
        // REST quote 已帶最後五檔 — 直接 seed 深度面板，不必等 WS snapshot
        if (quote === 'BidAsk' && entry?.book) {
            const bidask = bidaskFromBooks(symbol, {
                bids: entry.book.bids,
                asks: entry.book.asks,
            });
            const appCode = fromFugleSymbol(symbol);
            if (appCode !== symbol) bidask.code = appCode;
            const channels = this.channelFor(symbol);
            for (const cb of this.bidaskCbs) cb(channels.bidask, bidask);
        }
        const ws = await this.ensureWs(this.wsKindFor(symbol));
        ws.subscribe({
            channel: quote === 'Tick' ? 'trades' : 'books',
            symbol,
        });
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
