// server/src/providers/fugle/map.ts — Fugle payloads → frontend DTOs.
//
// Unit note: Fugle stock volumes are in shares for historical candles and
// in board lots (張) for intraday quote totals / WS trades. Verified
// against live data where possible; suspicious spots are marked.

/* eslint-disable @typescript-eslint/no-explicit-any */

import type {
    KBars,
    ScannerItem,
    Snapshot,
    SseBidAsk,
    SseTick,
} from '../../types/dto.ts';

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function fmt(v: unknown): string {
    return String(num(v));
}

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

/** fugle microsecond epoch (or ms) → {date:'YYYY-MM-DD', time:'HH:mm:ss.ffffff'} */
export function splitTime(t: unknown): { date: string; time: string } {
    let ms = num(t);
    let micros = 0;
    if (ms > 1e15) {
        micros = ms % 1_000_000;
        ms = Math.floor(ms / 1000);
    }
    const d = ms > 0 ? new Date(ms) : new Date();
    return {
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(micros || d.getMilliseconds() * 1000).padStart(6, '0')}`,
    };
}

/** normalize a fugle candle date ("2023-02-08" | ISO with offset) → wall clock */
export function candleDatetime(date: string): string {
    if (!date.includes('T')) return `${date} 13:30:00`;
    const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(date);
    return m ? `${m[1]} ${m[2]}` : date;
}

/** per-symbol intraday accumulators the WS trades stream maintains */
export interface DayState {
    open: number;
    high: number;
    low: number;
    last: number;
    avg: number;
    totalVolume: number;
    totalValue: number;
    reference: number;
    /** 昨收 — 除權息日 ≠ reference */
    prevClose: number;
    name: string;
    bid: number;
    ask: number;
    lastUpdatedMs: number;
}

export function dayStateFromQuote(q: any): DayState {
    // 參考價優先用 referencePrice（交易所公告今日參考價）— 除權息日
    // 它 ≠ previousClose（昨收），漲跌幅/漲跌停都要以它為基準
    const ref = num(q?.referencePrice ?? q?.previousClose);
    // pre-open the session has no trades yet: closePrice/lastPrice are
    // null — show the reference price instead of 0
    const last = num(q?.closePrice ?? q?.lastPrice) || ref;
    return {
        open: num(q?.openPrice) || last,
        high: num(q?.highPrice) || last,
        low: num(q?.lowPrice) || last,
        last,
        avg: num(q?.avgPrice),
        totalVolume: num(q?.total?.tradeVolume),
        totalValue: num(q?.total?.tradeValue),
        reference: ref,
        prevClose: num(q?.previousClose ?? q?.referencePrice),
        name: String(q?.name ?? ''),
        bid: num(q?.bids?.[0]?.price),
        ask: num(q?.asks?.[0]?.price),
        lastUpdatedMs: Date.now(),
    };
}

export function snapshotFromState(
    code: string,
    exchange: string,
    s: DayState,
): Snapshot {
    const chg = s.last - s.reference;
    return {
        code,
        exchange,
        datetime: new Date().toISOString().slice(0, 19).replace('T', ' '),
        open: s.open,
        high: s.high,
        low: s.low,
        close: s.last,
        average_price: s.avg,
        buy_price: s.bid,
        buy_volume: 0,
        sell_price: s.ask,
        sell_volume: 0,
        volume: 0,
        total_volume: s.totalVolume,
        amount: 0,
        total_amount: s.totalValue,
        change_price: Math.round(chg * 100) / 100,
        change_rate:
            s.reference > 0
                ? Math.round((chg / s.reference) * 10000) / 100
                : 0,
        change_type: chg > 0 ? 'Up' : chg < 0 ? 'Down' : 'Unchanged',
        tick_type: '',
        volume_ratio: 0,
        yesterday_volume: 0,
    };
}

/**
 * WS trades message → SseTick (decimal fields as strings)。
 * 收盤/總結 frame 可能帶 price=0（期貨 13:45 觀察到）— 此時退回
 * state.last 當價格；完全沒有可用價格回 null（呼叫端跳過發送），
 * 否則前端會顯示 0 元、-100%
 */
export function tickFromTrade(
    symbol: string,
    data: any,
    state: DayState,
): SseTick | null {
    const rawPrice = num(data.price);
    const { date, time } = splitTime(data.time);
    const isTrial = data.isTrial === true;
    if (!isTrial && rawPrice > 0) {
        state.last = rawPrice;
        if (state.open === 0) state.open = rawPrice;
        state.high = Math.max(state.high, rawPrice);
        state.low = state.low === 0 ? rawPrice : Math.min(state.low, rawPrice);
        state.totalVolume = num(data.volume) || state.totalVolume;
        state.lastUpdatedMs = Date.now();
    }
    if (num(data.bid) > 0) state.bid = num(data.bid);
    if (num(data.ask) > 0) state.ask = num(data.ask);
    const price = rawPrice > 0 ? rawPrice : state.last;
    if (price <= 0) return null;
    const chg = price - state.reference;
    return {
        code: symbol,
        date,
        time,
        open: fmt(state.open || price),
        high: fmt(state.high || price),
        low: fmt(state.low || price),
        close: fmt(price),
        avg_price: fmt(state.avg || price),
        volume: num(data.size),
        total_volume: num(data.volume) || state.totalVolume,
        amount: fmt(price * num(data.size)),
        total_amount: fmt(state.totalValue),
        // 內外盤: trade at/above ask → buy-side, at/below bid → sell-side
        tick_type:
            state.ask > 0 && price >= state.ask
                ? 1
                : state.bid > 0 && price <= state.bid
                  ? 2
                  : 0,
        chg_type: chg > 0 ? 2 : chg < 0 ? 4 : 3,
        price_chg: fmt(Math.round(chg * 100) / 100),
        pct_chg: fmt(
            state.reference > 0
                ? Math.round((chg / state.reference) * 10000) / 100
                : 0,
        ),
        simtrade: isTrial,
        ...(data.isLimitUpPrice === true ? { limit_up: true } : {}),
        ...(data.isLimitDownPrice === true ? { limit_down: true } : {}),
    };
}

/** WS books message → SseBidAsk (5 levels, padded) */
export function bidaskFromBooks(symbol: string, data: any): SseBidAsk {
    const { date, time } = splitTime(data.time);
    const bids: any[] = Array.isArray(data.bids) ? data.bids : [];
    const asks: any[] = Array.isArray(data.asks) ? data.asks : [];
    const level = (rows: any[], i: number) => rows[i] ?? {};
    return {
        code: symbol,
        date,
        time,
        bid_price: [0, 1, 2, 3, 4].map((i) => fmt(level(bids, i).price)),
        bid_volume: [0, 1, 2, 3, 4].map((i) => num(level(bids, i).size)),
        ask_price: [0, 1, 2, 3, 4].map((i) => fmt(level(asks, i).price)),
        ask_volume: [0, 1, 2, 3, 4].map((i) => num(level(asks, i).size)),
        simtrade: data.isTrial === true,
    };
}

/** historical/intraday candle rows → column-oriented KBars */
export function kbarsFromCandles(
    rows: any[],
    stockVolumeInShares: boolean,
): KBars {
    const out: KBars = {
        datetime: [],
        Open: [],
        High: [],
        Low: [],
        Close: [],
        Volume: [],
        Amount: [],
    };
    for (const row of rows) {
        out.datetime.push(candleDatetime(String(row.date ?? '')));
        out.Open.push(num(row.open));
        out.High.push(num(row.high));
        out.Low.push(num(row.low));
        out.Close.push(num(row.close));
        out.Volume.push(
            stockVolumeInShares
                ? Math.round(num(row.volume) / 1000)
                : num(row.volume),
        );
        out.Amount.push(num(row.turnover ?? row.value));
    }
    return out;
}

/** snapshot movers/actives rows → ScannerItem */
export function scannerItemFromRow(row: any, rankValue: number): ScannerItem {
    return {
        code: String(row.symbol ?? ''),
        name: String(row.name ?? ''),
        date: new Date().toISOString().slice(0, 10),
        close: num(row.closePrice ?? row.lastPrice),
        open: num(row.openPrice),
        high: num(row.highPrice),
        low: num(row.lowPrice),
        change_price: num(row.change),
        change_type: num(row.change) > 0 ? 2 : num(row.change) < 0 ? 4 : 3,
        average_price: num(row.avgPrice),
        price_range: num(row.highPrice) - num(row.lowPrice),
        rank_value: rankValue,
        total_volume: num(row.tradeVolume),
        total_amount: num(row.tradeValue),
        volume_ratio: 0,
        yesterday_volume: 0,
        tick_type: 0,
        buy_price: 0,
        sell_price: 0,
    };
}
