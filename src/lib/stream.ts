// src/lib/stream.ts — single combined SSE connection with auto-reconnect.
// Quote state lives here (module-level store) so components can subscribe
// via useSyncExternalStore without prop drilling.

import { getApiBase } from './runtime';
import type { SseBidAsk, SseTick } from './types/market';
import type { OrderEventData } from './types/order';

export type StreamStatus = 'connecting' | 'live' | 'down';

export interface QuoteState {
    tick?: SseTick;
    bidask?: SseBidAsk;
    lastDir: 1 | -1 | 0; // direction of last price move, for flash effects
    seq: number; // bumps on every update (tick or bidask)
    flashSeq: number; // bumps only on real trades (not simtrade/bidask)
}

const base = getApiBase();

type Listener = () => void;

const quotes = new Map<string, QuoteState>();
// continuous-month aliases (e.g. TXFR1): SSE events carry the resolved
// contract code (e.g. TXFF6); map it back to the display code.
const codeAlias = new Map<string, string>();

export function registerCodeAlias(actual: string, alias: string) {
    if (actual && alias && actual !== alias) {
        codeAlias.set(actual, alias);
    }
}
let status: StreamStatus = 'connecting';
let lastHeartbeat = 0;

const quoteListeners = new Map<string, Set<Listener>>();
const statusListeners = new Set<Listener>();
const orderEventListeners = new Set<(ev: OrderEventData) => void>();
const triggerEventListeners = new Set<(ev: unknown) => void>();
const reconnectListeners = new Set<() => void>();
const tickTapeListeners = new Set<(tick: SseTick) => void>();

function emitQuote(code: string) {
    quoteListeners.get(code)?.forEach((l) => l());
}

function setStatus(s: StreamStatus) {
    if (status !== s) {
        status = s;
        statusListeners.forEach((l) => l());
    }
}

function handleTick(raw: string) {
    const tick = JSON.parse(raw) as SseTick;
    if (tick.intraday_odd) return; // board shows regular-lot stream only
    ingestTick(tick);
    const alias = codeAlias.get(tick.code);
    if (alias) ingestTick({ ...tick, code: alias });
}

function ingestTick(tick: SseTick) {
    const prev = quotes.get(tick.code);
    const prevClose = prev?.tick ? Number(prev.tick.close) : undefined;
    const close = Number(tick.close);
    const lastDir: QuoteState['lastDir'] =
        prevClose === undefined || close === prevClose
            ? (prev?.lastDir ?? 0)
            : close > prevClose
              ? 1
              : -1;
    // flash only on real deals — simtrade (試撮) updates must not blink
    const isRealTrade = !tick.simtrade && tick.volume > 0;
    quotes.set(tick.code, {
        tick,
        bidask: prev?.bidask,
        lastDir,
        seq: (prev?.seq ?? 0) + 1,
        flashSeq: (prev?.flashSeq ?? 0) + (isRealTrade ? 1 : 0),
    });
    emitQuote(tick.code);
    if (isRealTrade) {
        tickTapeListeners.forEach((l) => l(tick));
    }
}

function handleBidAsk(raw: string) {
    const bidask = JSON.parse(raw) as SseBidAsk;
    if (bidask.intraday_odd) return;
    ingestBidAsk(bidask);
    const alias = codeAlias.get(bidask.code);
    if (alias) ingestBidAsk({ ...bidask, code: alias });
}

function ingestBidAsk(bidask: SseBidAsk) {
    const prev = quotes.get(bidask.code);
    quotes.set(bidask.code, {
        tick: prev?.tick,
        bidask,
        lastDir: prev?.lastDir ?? 0,
        seq: (prev?.seq ?? 0) + 1,
        flashSeq: prev?.flashSeq ?? 0,
    });
    emitQuote(bidask.code);
}

// registry of every quote subscription made this session — replayed after
// the SSE connection recovers (covers local-server restarts)
const subscriptionRegistry = new Map<string, Record<string, unknown>>();

export function registerSubscription(body: {
    security_type: string | null;
    exchange: string | null;
    code: string;
    target_code: string | null;
    quote_type: string;
    intraday_odd: boolean;
}) {
    subscriptionRegistry.set(`${body.code}:${body.quote_type}`, body);
}

let resubscribeTimer: ReturnType<typeof setTimeout> | null = null;
let resubscribing = false;

async function resubscribeAll(attempt = 0) {
    // 同一時間只允許一條重試鏈。連線抖動會連續觸發 onopen，若不擋會疊出
    // 多條並發 backoff 同時 re-POST 整個 registry，正好打在剛重啟、還在喘
    // 的 server 上。in-flight 期間的重入直接略過——現有那條會 replay 全部
    // 訂閱（含期間新註冊的），不漏。
    if (attempt === 0) {
        if (resubscribing) return;
        resubscribing = true;
    }
    let failed = false;
    for (const body of subscriptionRegistry.values()) {
        try {
            const res = await fetch(`${base}/api/v1/stream/subscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!res.ok) failed = true;
        } catch {
            failed = true;
        }
    }
    // server 重啟瞬間 POST 可能落空，且連線若已恢復就不會再有
    // onopen 來補發 — 自己重試，不能等用戶手動重整
    if (failed && attempt < 5) {
        resubscribeTimer = setTimeout(
            () => void resubscribeAll(attempt + 1),
            2000 * (attempt + 1),
        );
    } else {
        resubscribeTimer = null;
        resubscribing = false;
    }
}

let es: EventSource | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 1000;
let everDown = false;

function connect() {
    if (es) es.close();
    setStatus('connecting');
    es = new EventSource(`${base}/api/v1/stream/data`);

    es.onopen = () => {
        retryDelay = 1000;
        setStatus('live');
        if (everDown) {
            everDown = false;
            void resubscribeAll(); // server may have restarted — replay subs
            reconnectListeners.forEach((l) => l()); // stores refetch missed events
        }
    };

    for (const ev of ['tick_stk', 'tick_fop']) {
        es.addEventListener(ev, (e) => handleTick((e as MessageEvent).data));
    }
    for (const ev of ['bidask_stk', 'bidask_fop']) {
        es.addEventListener(ev, (e) => handleBidAsk((e as MessageEvent).data));
    }
    es.addEventListener('trigger_event', (e) => {
        try {
            const data = JSON.parse((e as MessageEvent).data);
            triggerEventListeners.forEach((l) => l(data));
        } catch {
            // malformed frame
        }
    });
    es.addEventListener('order_event', (e) => {
        const data = JSON.parse((e as MessageEvent).data) as OrderEventData;
        orderEventListeners.forEach((l) => l(data));
    });
    es.addEventListener('heartbeat', () => {
        lastHeartbeat = Date.now();
        setStatus('live');
    });

    es.onerror = () => {
        everDown = true;
        setStatus('down');
        es?.close();
        es = null;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 15000);
    };
}

let started = false;
export function ensureStream() {
    if (!started) {
        started = true;
        connect();
    }
}

// ---- store API (for useSyncExternalStore) ----

export function subscribeQuoteStore(code: string, listener: Listener) {
    let set = quoteListeners.get(code);
    if (!set) {
        set = new Set();
        quoteListeners.set(code, set);
    }
    set.add(listener);
    return () => {
        set.delete(listener);
    };
}

export function getQuote(code: string): QuoteState | undefined {
    return quotes.get(code);
}

export function subscribeStatusStore(listener: Listener) {
    statusListeners.add(listener);
    return () => {
        statusListeners.delete(listener);
    };
}

export function getStreamStatus(): StreamStatus {
    return status;
}

export function getLastHeartbeat(): number {
    return lastHeartbeat;
}

export function onOrderEvent(listener: (ev: OrderEventData) => void) {
    orderEventListeners.add(listener);
    return () => {
        orderEventListeners.delete(listener);
    };
}

export function onTriggerEvent(listener: (ev: unknown) => void) {
    triggerEventListeners.add(listener);
    return () => {
        triggerEventListeners.delete(listener);
    };
}

/** fires after the SSE stream recovers from a disconnect — consumers
 *  should refetch state that is normally kept fresh by events */
export function onStreamReconnected(listener: () => void) {
    reconnectListeners.add(listener);
    return () => {
        reconnectListeners.delete(listener);
    };
}

export function onAnyTick(listener: (tick: SseTick) => void) {
    tickTapeListeners.add(listener);
    return () => {
        tickTapeListeners.delete(listener);
    };
}
