// src/lib/utils/kbars.ts — KBars column arrays -> candles, aggregation

import type { Candle, KBars } from '../types/market';

// kbar datetimes are Taiwan local; encode wall-clock as UTC so the chart
// axis shows Taiwan session times regardless of viewer timezone.
export function wallClockToUtc(dt: string): number {
    const y = Number(dt.slice(0, 4));
    const mo = Number(dt.slice(5, 7));
    const d = Number(dt.slice(8, 10));
    const h = Number(dt.slice(11, 13)) || 0;
    const mi = Number(dt.slice(14, 16)) || 0;
    const s = Number(dt.slice(17, 19)) || 0;
    return Date.UTC(y, mo - 1, d, h, mi, s) / 1000;
}

export function kbarsToCandles(k: KBars): Candle[] {
    const out: Candle[] = [];
    for (let i = 0; i < k.datetime.length; i++) {
        const dt = k.datetime[i];
        if (!dt) continue;
        out.push({
            time: wallClockToUtc(dt),
            open: k.Open[i] ?? 0,
            high: k.High[i] ?? 0,
            low: k.Low[i] ?? 0,
            close: k.Close[i] ?? 0,
            volume: k.Volume[i] ?? 0,
        });
    }
    out.sort((a, b) => a.time - b.time);
    return out;
}

// Aggregate 1-minute candles into N-minute or daily bars.
/** 週K = 10080 分、月K = 43200 分（calendar 對齊，非固定視窗） */
export const WEEK_MINUTES = 10080;
export const MONTH_MINUTES = 43200;

const DAY_SEC = 86400;

/** K 棒分桶：分鐘級固定視窗；日=UTC 日；週=錨定週一；月=錨定月初 */
export function bucketTime(timeSec: number, minutes: number): number {
    if (minutes >= MONTH_MINUTES) {
        const d = new Date(timeSec * 1000);
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
    }
    if (minutes >= WEEK_MINUTES) {
        const days = Math.floor(timeSec / DAY_SEC);
        const dow = (days + 4) % 7; // epoch 起算：0=日 … 6=六
        const offsetToMonday = (dow + 6) % 7;
        return (days - offsetToMonday) * DAY_SEC;
    }
    if (minutes >= 1440) {
        return Math.floor(timeSec / DAY_SEC) * DAY_SEC;
    }
    const bucketSec = minutes * 60;
    return Math.floor(timeSec / bucketSec) * bucketSec;
}

export function aggregate(candles: Candle[], minutes: number): Candle[] {
    if (minutes <= 1) return candles;
    const out: Candle[] = [];
    let cur: Candle | null = null;
    for (const c of candles) {
        const bucket = bucketTime(c.time, minutes);
        if (!cur || cur.time !== bucket) {
            if (cur) out.push(cur);
            cur = { ...c, time: bucket };
        } else {
            cur.high = Math.max(cur.high, c.high);
            cur.low = Math.min(cur.low, c.low);
            cur.close = c.close;
            cur.volume += c.volume;
        }
    }
    if (cur) out.push(cur);
    return out;
}

export function dateStrOffset(daysAgo: number): string {
    const d = new Date(Date.now() - daysAgo * 86400_000);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
