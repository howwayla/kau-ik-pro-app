// server/src/providers/mock/random-walk.ts — the mock market engine.
//
// Two data planes share one model:
//  - history: deterministic per (code, date) — daily closes walk from a
//    fixed anchor date, intraday minutes bridge open→close with pinned
//    noise, so charts are stable across reloads.
//  - live: a random walk stepped on a timer for subscribed codes, seeded
//    from today's deterministic series so the chart and the tape agree.
//
// Option prices are derived from the underlying futures state so the TXO
// chain moves coherently with the index.

import type {
    HistoryTicks,
    KBars,
    Snapshot,
    SseBidAsk,
    SseTick,
} from '../../types/dto.ts';
import type {
    BidAskChannel,
    TickChannel,
} from '../market-data.ts';
import { gaussian, hashStr, mulberry32 } from './prng.ts';
import {
    buildInstruments,
    buildOptionChain,
    optionPremium,
    roundToTick,
    tickSizeFor,
    type SeedInstrument,
} from './seed.ts';
import type { OptContract } from '../../types/dto.ts';

const ANCHOR = new Date(2024, 0, 2); // daily walk origin (a Tuesday)
const STEP_MS = 250;

interface PriceState {
    inst: SeedInstrument;
    prevClose: number;
    last: number;
    open: number;
    high: number;
    low: number;
    totalVolume: number;
    totalAmount: number;
    lastVolume: number;
    lastTickType: number;
    nextStepAt: number;
}

interface DayBar {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

export function dateStr(d: Date): string {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeStr(d: Date): string {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}000`;
}

function fmt(price: number): string {
    return String(Math.round(price * 100) / 100);
}

function isWeekend(d: Date): boolean {
    return d.getDay() === 0 || d.getDay() === 6;
}

function sessionFor(inst: SeedInstrument): { start: number; end: number } {
    // minutes from midnight; futures/options/index day session 08:45–13:45
    if (inst.security_type === 'STK') return { start: 540, end: 810 };
    return { start: 525, end: 825 };
}

export class MockMarketEngine {
    private instruments: Map<string, SeedInstrument>;
    private optContracts: OptContract[];
    private states = new Map<string, PriceState>();
    private dailyCache = new Map<string, Map<string, DayBar>>();
    private minuteCache = new Map<string, DayBar[]>();

    private tickSubs = new Map<string, number>();
    private bidaskSubs = new Map<string, number>();
    private walkRefs = new Map<string, number>();
    private timer: NodeJS.Timeout | null = null;
    private liveRand = mulberry32(hashStr(`live:${dateStr(new Date())}`));

    private tickCbs: ((ch: TickChannel, t: SseTick) => void)[] = [];
    private bidaskCbs: ((ch: BidAskChannel, b: SseBidAsk) => void)[] = [];
    private priceCbs: ((code: string, price: number) => void)[] = [];

    constructor() {
        this.instruments = buildInstruments();
        const chain = buildOptionChain();
        this.optContracts = chain.contracts;
        for (const inst of chain.instruments) {
            this.instruments.set(inst.code, inst);
        }
        // option references derive from the underlying futures reference
        for (const c of this.optContracts) {
            const ref = optionPremium(
                c.strike_price,
                c.option_right,
                this.underlyingReference(),
            );
            c.reference = Math.round(ref * 100) / 100;
            const inst = this.instruments.get(c.code);
            if (inst) inst.reference = c.reference;
        }
    }

    // ---- instrument lookup ----

    getInstrument(code: string): SeedInstrument | undefined {
        return this.instruments.get(code);
    }

    listOptionContracts(): OptContract[] {
        return this.optContracts;
    }

    instrumentCount(): number {
        return this.instruments.size;
    }

    listStockCodes(): string[] {
        return [...this.instruments.values()]
            .filter((i) => i.security_type === 'STK')
            .map((i) => i.code);
    }

    private resolve(code: string): SeedInstrument {
        const inst = this.instruments.get(code);
        if (!inst) throw new Error(`unknown instrument: ${code}`);
        if (inst.target_code) {
            const target = this.instruments.get(inst.target_code);
            if (target) return target;
        }
        return inst;
    }

    private underlyingReference(): number {
        return this.instruments.get('001')?.reference ?? 23000;
    }

    private underlyingFut(): SeedInstrument | undefined {
        for (const inst of this.instruments.values()) {
            if (inst.category === 'TXF' && !inst.target_code) return inst;
        }
        return undefined;
    }

    // ---- deterministic history ----

    /** daily bars walked from ANCHOR so any sub-range is consistent */
    private dailyBars(inst: SeedInstrument): Map<string, DayBar> {
        const cached = this.dailyCache.get(inst.code);
        if (cached) return cached;
        const bars = new Map<string, DayBar>();
        const rand = mulberry32(hashStr(`daily:${inst.code}`));
        let close = inst.reference * (0.95 + rand() * 0.05);
        const vol = inst.security_type === 'IND' ? 0.007 : 0.012;
        const cur = new Date(ANCHOR);
        const stop = new Date();
        stop.setDate(stop.getDate() + 1);
        while (cur < stop) {
            if (!isWeekend(cur)) {
                const open = close * (1 + gaussian(rand) * 0.004);
                // mean-revert toward reference so multi-year walks stay sane
                const drift = (inst.reference - close) / inst.reference;
                let next = close * (1 + gaussian(rand) * vol + drift * 0.12);
                next = Math.max(next, inst.reference * 0.35);
                const high = Math.max(open, next) * (1 + rand() * 0.006);
                const low = Math.min(open, next) * (1 - rand() * 0.006);
                const volume = Math.round(
                    (inst.security_type === 'STK' ? 18000 : 90000) *
                        (0.5 + rand()),
                );
                bars.set(dateStr(cur), {
                    open: roundToTick(inst, open),
                    high: roundToTick(inst, high),
                    low: roundToTick(inst, low),
                    close: roundToTick(inst, next),
                    volume,
                });
                close = next;
            }
            cur.setDate(cur.getDate() + 1);
        }
        this.dailyCache.set(inst.code, bars);
        return bars;
    }

    private optionDayBar(inst: SeedInstrument, date: string): DayBar | undefined {
        // derive the option's day bar from the underlying futures day bar
        const fut = this.underlyingFut();
        if (!fut) return undefined;
        const futBar = this.dailyBars(fut).get(date);
        if (!futBar) return undefined;
        const opt = this.optContracts.find((c) => c.code === inst.code);
        if (!opt) return undefined;
        const at = (s: number) =>
            roundToTick(
                inst,
                optionPremium(opt.strike_price, opt.option_right, s),
            );
        const open = at(futBar.open);
        const close = at(futBar.close);
        return {
            open,
            close,
            high: Math.max(at(futBar.high), open, close),
            low: Math.min(at(futBar.low), open, close),
            volume: Math.round(futBar.volume / 50) + 10,
        };
    }

    private futuresDayBar(
        inst: SeedInstrument,
        date: string,
    ): DayBar | undefined {
        // futures track the index daily bar plus a small premium so the
        // TXF basis shown in the market bar stays plausible
        const idx = this.instruments.get('001');
        if (!idx) return undefined;
        const idxBar = this.dailyBars(idx).get(date);
        if (!idxBar) return undefined;
        const rand = mulberry32(hashStr(`basis:${inst.code}:${date}`));
        const basis = 20 + rand() * 60;
        const at = (p: number) => roundToTick(inst, p + basis);
        return {
            open: at(idxBar.open),
            high: at(idxBar.high),
            low: at(idxBar.low),
            close: at(idxBar.close),
            volume: Math.round(idxBar.volume * (inst.category === 'MXF' ? 0.6 : 1.2)),
        };
    }

    private dayBar(inst: SeedInstrument, date: string): DayBar | undefined {
        if (inst.security_type === 'OPT') return this.optionDayBar(inst, date);
        if (inst.security_type === 'FUT') return this.futuresDayBar(inst, date);
        return this.dailyBars(inst).get(date);
    }

    /** previous trading day's close (falls back to the seed reference) */
    prevCloseFor(code: string): number {
        const inst = this.resolve(code);
        const cur = new Date();
        for (let i = 1; i <= 7; i++) {
            cur.setDate(cur.getDate() - 1);
            if (isWeekend(cur)) continue;
            const bar = this.dayBar(inst, dateStr(cur));
            if (bar) return bar.close;
        }
        return inst.reference;
    }

    /** 1-minute bars bridging the day's open→close with pinned noise */
    private minuteBars(inst: SeedInstrument, date: string): DayBar[] {
        const cacheKey = `${inst.code}:${date}`;
        const cached = this.minuteCache.get(cacheKey);
        if (cached) return cached;
        const day = this.dayBar(inst, date);
        if (!day) return [];
        const { start, end } = sessionFor(inst);
        const n = end - start;
        const rand = mulberry32(hashStr(`min:${inst.code}:${date}`));
        // random walk with both ends pinned to 0
        const walk: number[] = [0];
        for (let i = 1; i <= n; i++) {
            walk.push(walk[i - 1]! + gaussian(rand));
        }
        const wEnd = walk[n]!;
        const span = day.high - day.low || day.open * 0.01;
        const closes: number[] = [];
        for (let i = 0; i <= n; i++) {
            const pinned = walk[i]! - (wEnd * i) / n;
            const base = day.open + ((day.close - day.open) * i) / n;
            const p = Math.min(
                day.high,
                Math.max(day.low, base + pinned * span * 0.08),
            );
            closes.push(roundToTick(inst, p));
        }
        const bars: DayBar[] = [];
        for (let i = 1; i <= n; i++) {
            const open = closes[i - 1]!;
            const close = closes[i]!;
            const tick = tickSizeFor(inst, close);
            // U-shaped volume: heavier near open and close
            const u = ((i / n - 0.5) * 2) ** 2;
            const volume = Math.max(
                1,
                Math.round((day.volume / n) * (0.5 + u * 1.6) * (0.4 + rand() * 1.2)),
            );
            bars.push({
                open,
                close,
                high: Math.max(open, close) + (rand() < 0.5 ? tick : 0),
                low: Math.min(open, close) - (rand() < 0.5 ? tick : 0),
                volume,
            });
        }
        this.minuteCache.set(cacheKey, bars);
        return bars;
    }

    kbars(code: string, start: string, end: string): KBars {
        const inst = this.resolve(code);
        const out: KBars = {
            datetime: [],
            Open: [],
            High: [],
            Low: [],
            Close: [],
            Volume: [],
            Amount: [],
        };
        const startDate = new Date(`${start}T00:00:00`);
        const endDate = new Date(`${end}T00:00:00`);
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
            return out;
        }
        const rangeDays =
            (endDate.getTime() - startDate.getTime()) / 86_400_000;
        const daily = rangeDays > 70;
        const today = dateStr(new Date());
        const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
        const { start: sessionStart } = sessionFor(inst);
        const cur = new Date(startDate);
        while (cur <= endDate) {
            const ds = dateStr(cur);
            if (!isWeekend(cur)) {
                if (daily) {
                    const bar = this.dayBar(inst, ds);
                    if (bar) {
                        out.datetime.push(`${ds} 13:30:00`);
                        out.Open.push(bar.open);
                        out.High.push(bar.high);
                        out.Low.push(bar.low);
                        out.Close.push(bar.close);
                        out.Volume.push(bar.volume);
                        out.Amount.push(
                            Math.round(bar.close * bar.volume * inst.multiplier),
                        );
                    }
                } else {
                    const bars = this.minuteBars(inst, ds);
                    for (let i = 0; i < bars.length; i++) {
                        const minute = sessionStart + i;
                        if (ds === today && minute > nowMin) break;
                        const bar = bars[i]!;
                        const hh = pad(Math.floor((minute + 1) / 60));
                        const mm = pad((minute + 1) % 60);
                        out.datetime.push(`${ds} ${hh}:${mm}:00`);
                        out.Open.push(bar.open);
                        out.High.push(bar.high);
                        out.Low.push(bar.low);
                        out.Close.push(bar.close);
                        out.Volume.push(bar.volume);
                        out.Amount.push(
                            Math.round(bar.close * bar.volume * inst.multiplier),
                        );
                    }
                }
            }
            cur.setDate(cur.getDate() + 1);
        }
        return out;
    }

    ticks(code: string, date: string, lastCount?: number): HistoryTicks {
        const inst = this.resolve(code);
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
        const bars = this.minuteBars(inst, date);
        if (bars.length === 0) return out;
        const rand = mulberry32(hashStr(`tick:${inst.code}:${date}`));
        const { start: sessionStart } = sessionFor(inst);
        const today = dateStr(new Date());
        const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
        const perMinute = 6;
        for (let i = 0; i < bars.length; i++) {
            const minute = sessionStart + i;
            if (date === today && minute > nowMin) break;
            const bar = bars[i]!;
            for (let j = 0; j < perMinute; j++) {
                const frac = (j + 1) / perMinute;
                const price = roundToTick(
                    inst,
                    bar.open + (bar.close - bar.open) * frac +
                        (rand() - 0.5) * (bar.high - bar.low),
                );
                const tick = tickSizeFor(inst, price);
                const tickType = rand() < 0.5 ? 1 : 2;
                const sec = Math.floor(60 * frac) % 60;
                const hh = pad(Math.floor(minute / 60));
                const mm = pad(minute % 60);
                out.datetime.push(
                    `${date} ${hh}:${mm}:${pad(sec)}.${String(Math.floor(rand() * 1000)).padStart(3, '0')}000`,
                );
                out.close.push(price);
                out.volume.push(Math.max(1, Math.round(bar.volume / perMinute)));
                out.bid_price.push(roundToTick(inst, price - tick));
                out.bid_volume.push(Math.round(5 + rand() * 50));
                out.ask_price.push(roundToTick(inst, price + tick));
                out.ask_volume.push(Math.round(5 + rand() * 50));
                out.tick_type.push(tickType);
            }
        }
        if (lastCount && out.datetime.length > lastCount) {
            for (const k of Object.keys(out) as (keyof HistoryTicks)[]) {
                out[k] = out[k].slice(-lastCount) as never;
            }
        }
        return out;
    }

    // ---- live state ----

    ensureState(code: string): PriceState {
        const inst = this.resolve(code);
        let state = this.states.get(inst.code);
        if (state) return state;
        const today = dateStr(new Date());
        const bars = this.minuteBars(inst, today);
        const { start: sessionStart } = sessionFor(inst);
        const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
        const elapsed = Math.max(
            0,
            Math.min(bars.length, nowMin - sessionStart),
        );
        const seen = bars.slice(0, Math.max(1, elapsed));
        const first = seen[0];
        const last = seen[seen.length - 1];
        const open = first?.open ?? inst.reference;
        state = {
            inst,
            prevClose: this.prevCloseFor(inst.code),
            last: last?.close ?? inst.reference,
            open,
            high: seen.reduce((m, b) => Math.max(m, b.high), open),
            low: seen.reduce((m, b) => Math.min(m, b.low), open),
            totalVolume: seen.reduce((s, b) => s + b.volume, 0),
            totalAmount: seen.reduce(
                (s, b) => s + b.close * b.volume * inst.multiplier,
                0,
            ),
            lastVolume: last?.volume ?? 0,
            lastTickType: 0,
            nextStepAt: 0,
        };
        this.states.set(inst.code, state);
        return state;
    }

    lastPrice(code: string): number {
        return this.ensureState(code).last;
    }

    referencePrice(code: string): number {
        return this.resolve(code).reference;
    }

    // ---- subscriptions & walk loop ----

    onTick(cb: (ch: TickChannel, t: SseTick) => void): void {
        this.tickCbs.push(cb);
    }

    onBidAsk(cb: (ch: BidAskChannel, b: SseBidAsk) => void): void {
        this.bidaskCbs.push(cb);
    }

    onPrice(cb: (code: string, price: number) => void): void {
        this.priceCbs.push(cb);
    }

    private bump(map: Map<string, number>, code: string, delta: number): void {
        const next = (map.get(code) ?? 0) + delta;
        if (next > 0) map.set(code, next);
        else map.delete(code);
    }

    subscribe(code: string, quote: 'Tick' | 'BidAsk'): void {
        const inst = this.resolve(code);
        this.ensureState(inst.code);
        this.bump(quote === 'Tick' ? this.tickSubs : this.bidaskSubs, inst.code, 1);
        this.acquireWalk(inst.code);
    }

    unsubscribe(code: string, quote: 'Tick' | 'BidAsk'): void {
        const inst = this.resolve(code);
        this.bump(quote === 'Tick' ? this.tickSubs : this.bidaskSubs, inst.code, -1);
        this.releaseWalk(inst.code);
    }

    /** keep a code walking without SSE emission (open limit orders) */
    acquireWalk(code: string): void {
        const inst = this.resolve(code);
        this.ensureState(inst.code);
        this.bump(this.walkRefs, inst.code, 1);
        if (!this.timer) {
            this.timer = setInterval(() => this.loop(), STEP_MS);
            this.timer.unref();
        }
    }

    releaseWalk(code: string): void {
        const inst = this.resolve(code);
        this.bump(this.walkRefs, inst.code, -1);
        if (this.walkRefs.size === 0 && this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    private loop(): void {
        const now = Date.now();
        for (const code of this.walkRefs.keys()) {
            const state = this.states.get(code);
            if (!state) continue;
            if (now < state.nextStepAt) continue;
            state.nextStepAt = now + 300 + this.liveRand() * 600;
            this.step(state);
        }
    }

    private step(state: PriceState): void {
        const { inst } = state;
        let price: number;
        if (inst.security_type === 'OPT') {
            const fut = this.underlyingFut();
            const opt = this.optContracts.find((c) => c.code === inst.code);
            if (!fut || !opt) return;
            // nudge the underlying so option chains move even when the
            // futures contract itself isn't subscribed
            const futState = this.ensureState(fut.code);
            if (!this.walkRefs.has(fut.code)) this.stepPrice(futState);
            price = roundToTick(
                inst,
                optionPremium(opt.strike_price, opt.option_right, futState.last) *
                    (1 + (this.liveRand() - 0.5) * 0.02),
            );
            this.applyPrice(state, price);
        } else {
            price = this.stepPrice(state);
        }
        const emitTick = this.tickSubs.has(inst.code);
        const emitBidAsk = this.bidaskSubs.has(inst.code);
        if (emitTick) {
            this.emitTick(state);
        }
        if (emitBidAsk && this.liveRand() < 0.4) {
            this.emitBidAsk(state);
        }
        for (const cb of this.priceCbs) cb(inst.code, price);
    }

    private stepPrice(state: PriceState): number {
        const { inst } = state;
        const tick = tickSizeFor(inst, state.last);
        const drift = (state.prevClose - state.last) / Math.max(state.prevClose, 1);
        const move =
            gaussian(this.liveRand) * tick * 0.55 +
            drift * state.prevClose * 0.0005;
        let price = state.last + move;
        const limitUp = roundToTick(inst, state.prevClose * 1.1);
        const limitDown = roundToTick(inst, state.prevClose * 0.9);
        price = Math.min(limitUp, Math.max(limitDown, roundToTick(inst, price)));
        this.applyPrice(state, price);
        return price;
    }

    private applyPrice(state: PriceState, price: number): void {
        const volume = Math.max(1, Math.round(this.liveRand() * 15));
        state.lastTickType = price >= state.last ? 1 : 2;
        state.last = price;
        state.high = Math.max(state.high, price);
        state.low = Math.min(state.low, price);
        state.totalVolume += volume;
        state.totalAmount += price * volume * state.inst.multiplier;
        state.lastVolume = volume;
    }

    private emitTick(state: PriceState): void {
        const now = new Date();
        const { inst } = state;
        const chg = state.last - state.prevClose;
        const tick: SseTick = {
            code: inst.code,
            date: dateStr(now),
            time: timeStr(now),
            open: fmt(state.open),
            high: fmt(state.high),
            low: fmt(state.low),
            close: fmt(state.last),
            avg_price: fmt(
                state.totalVolume > 0
                    ? state.totalAmount / state.totalVolume / inst.multiplier
                    : state.last,
            ),
            volume: state.lastVolume,
            total_volume: state.totalVolume,
            amount: fmt(state.last * state.lastVolume * inst.multiplier),
            total_amount: fmt(state.totalAmount),
            tick_type: state.lastTickType,
            chg_type: chg > 0 ? 2 : chg < 0 ? 4 : 3,
            price_chg: fmt(chg),
            pct_chg: fmt(
                state.prevClose > 0 ? (chg / state.prevClose) * 100 : 0,
            ),
            simtrade: false,
        };
        const channel: TickChannel =
            inst.security_type === 'FUT' || inst.security_type === 'OPT'
                ? 'tick_fop'
                : 'tick_stk';
        for (const cb of this.tickCbs) cb(channel, tick);
    }

    private emitBidAsk(state: PriceState): void {
        const now = new Date();
        const { inst } = state;
        const tick = tickSizeFor(inst, state.last);
        const bid_price: string[] = [];
        const ask_price: string[] = [];
        const bid_volume: number[] = [];
        const ask_volume: number[] = [];
        for (let i = 1; i <= 5; i++) {
            bid_price.push(fmt(roundToTick(inst, state.last - tick * i)));
            ask_price.push(fmt(roundToTick(inst, state.last + tick * i)));
            bid_volume.push(Math.round(3 + this.liveRand() * 80));
            ask_volume.push(Math.round(3 + this.liveRand() * 80));
        }
        const bidask: SseBidAsk = {
            code: inst.code,
            date: dateStr(now),
            time: timeStr(now),
            bid_price,
            bid_volume,
            ask_price,
            ask_volume,
            simtrade: false,
        };
        const channel: BidAskChannel =
            inst.security_type === 'FUT' || inst.security_type === 'OPT'
                ? 'bidask_fop'
                : 'bidask_stk';
        for (const cb of this.bidaskCbs) cb(channel, bidask);
    }

    // ---- snapshots ----

    snapshot(code: string): Snapshot | null {
        const inst = this.instruments.get(code);
        if (!inst) return null;
        const state = this.ensureState(code);
        const resolved = state.inst;
        const yesterdayVolume = Math.round(state.totalVolume * 0.9) + 100;
        const chg = state.last - state.prevClose;
        const tick = tickSizeFor(resolved, state.last);
        return {
            code,
            exchange: inst.exchange ?? 'TSE',
            datetime: `${dateStr(new Date())} ${timeStr(new Date()).slice(0, 8)}`,
            open: state.open,
            high: state.high,
            low: state.low,
            close: state.last,
            average_price:
                state.totalVolume > 0
                    ? Math.round(
                          (state.totalAmount /
                              state.totalVolume /
                              resolved.multiplier) *
                              100,
                      ) / 100
                    : state.last,
            buy_price: roundToTick(resolved, state.last - tick),
            buy_volume: Math.round(5 + this.liveRand() * 60),
            sell_price: roundToTick(resolved, state.last + tick),
            sell_volume: Math.round(5 + this.liveRand() * 60),
            volume: state.lastVolume,
            total_volume: state.totalVolume,
            amount: Math.round(state.last * state.lastVolume * resolved.multiplier),
            total_amount: Math.round(state.totalAmount),
            change_price: Math.round(chg * 100) / 100,
            change_rate:
                state.prevClose > 0
                    ? Math.round((chg / state.prevClose) * 10000) / 100
                    : 0,
            change_type: chg > 0 ? 'Up' : chg < 0 ? 'Down' : 'Unchanged',
            tick_type: state.lastTickType === 1 ? 'Buy' : 'Sell',
            volume_ratio:
                yesterdayVolume > 0
                    ? Math.round((state.totalVolume / yesterdayVolume) * 100) / 100
                    : 1,
            yesterday_volume: yesterdayVolume,
        };
    }
}
