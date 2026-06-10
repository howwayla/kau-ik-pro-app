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

interface CacheEntry {
    state: DayState;
    exchange: string;
    fetchedAt: number;
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

    constructor(private apiKey: string) {}

    async init(): Promise<void> {
        if (!this.apiKey) throw new Error('需要 Fugle API Key');
        this.sdk = await import('@fugle/marketdata');
        this.rest = new this.sdk.RestClient({ apiKey: this.apiKey });
        // validate the key with a cheap call
        const probe = await this.rest.stock.intraday.quote({ symbol: '2330' });
        if (!probe || probe.statusCode === 401 || probe.status === 401) {
            throw new Error('Fugle API Key 無效（401）');
        }
        if (probe.statusCode && probe.statusCode >= 400) {
            throw new Error(
                `Fugle API 驗證失敗（${probe.statusCode}）: ${probe.message ?? ''}`,
            );
        }
        if (!probe.symbol) {
            throw new Error(
                `Fugle API 回應異常: ${JSON.stringify(probe).slice(0, 200)}`,
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
        const client = new this.sdk.WebSocketClient({ apiKey: this.apiKey });
        const ws = kind === 'stock' ? client.stock : client.futopt;
        ws.on('message', (raw: any) => {
            try {
                const msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
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
        await ws.connect();
        if (kind === 'stock') this.stockWs = ws;
        else this.futoptWs = ws;
        return ws;
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
        if (msg?.event !== 'data' || !msg.data) return;
        const data = msg.data;
        const symbol = String(data.symbol ?? '');
        if (!symbol) return;
        const channels = this.channelFor(symbol);
        if (msg.channel === 'trades') {
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
        } else if (msg.channel === 'books') {
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

    private async futuresTickers(): Promise<any[]> {
        if (this.futTickers && Date.now() - this.futTickersAt < TICKERS_TTL_MS) {
            return this.futTickers;
        }
        const res = await this.rest.futopt.intraday.tickers({ type: 'FUTURE' });
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
        const ref = state.previousClose || state.last;
        return {
            exchange: exchange as ContractInfo['exchange'],
            code,
            security_type: type,
            target_code: null,
            name: state.name || code,
            currency: 'TWD',
            limit_up: Math.round(ref * 1.1 * 100) / 100,
            limit_down: Math.round(ref * 0.9 * 100) / 100,
            reference: ref,
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

    // chips data has no fugle source — frontend handles empty results
    async creditEnquire(_keys: ContractKey[]): Promise<CreditEnquire[]> {
        return [];
    }

    async shortStockSources(_keys: ContractKey[]): Promise<ShortSource[]> {
        return [];
    }

    async regulatoryPunish(): Promise<{ code: string[] }> {
        return { code: [] };
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
        await this.fetchQuote(symbol);
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
