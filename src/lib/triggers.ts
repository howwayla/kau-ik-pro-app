// src/lib/triggers.ts — thin client of the SERVER trigger engine.
// The old in-browser engine is gone: triggers live in the local server
// (L2 protection — they survive closed tabs), this store mirrors them via
// REST + the 'trigger_event' SSE stream, so every tab stays in sync.

import { useSyncExternalStore } from 'react';
import { apiDelete, apiGet, apiPatch, apiPost } from './api';
import { ensureContract } from './contracts-cache';
import { onStreamReconnected, onTriggerEvent } from './stream';
import { notify } from './trade';
import type { ContractBase } from './types/contract';
import type { Action } from './types/order';

export type TriggerKind = 'stop' | 'take' | 'alert';

export interface TriggerRow {
    id: string;
    contract: {
        security_type: string | null;
        exchange: string | null;
        code: string;
    };
    code: string;
    condition: 'below' | 'above';
    price: number;
    action: Action;
    quantity: number;
    kind: TriggerKind;
    group?: string;
    broker: string;
    accountType: 'S' | 'F';
    expiry: 'day' | 'gtc';
    state: 'active' | 'suspended';
    suspendReason?: string;
    tradingDay: string;
    createdAt: number;
}

export interface TriggerStatus {
    broker: string;
    market: string;
    feed_mode: 'ws' | 'poll' | 'mock';
    feed_warning?: string;
    active: number;
    suspended: number;
    pending_brackets: number;
    last_price_at: number | null;
}

interface TriggerEventMsg {
    type: string;
    trigger?: TriggerRow;
    id?: string;
    message?: string;
    price?: number;
    imported?: number;
    dropped?: number;
}

let rows: TriggerRow[] = [];
let status: TriggerStatus | null = null;
let statusFailed = false; // server unreachable → protection offline
const listeners = new Set<() => void>();

function emit() {
    listeners.forEach((l) => l());
}

async function refetch() {
    try {
        const res = await apiGet<{ triggers: TriggerRow[] }>('/api/v1/triggers');
        rows = res.triggers;
        emit();
    } catch {
        // server down — status poll surfaces it
    }
}

async function refetchStatus() {
    try {
        status = await apiGet<TriggerStatus>('/api/v1/triggers/status');
        statusFailed = false;
    } catch {
        statusFailed = true;
    }
    emit();
}

const KIND_ICON: Record<string, string> = {
    stop: '⛔',
    take: '🎯',
    alert: '🔔',
};

function toast(ev: TriggerEventMsg) {
    const t = ev.trigger;
    switch (ev.type) {
        case 'fired':
            if (t?.kind === 'alert') {
                notify({
                    kind: 'info',
                    title: '🔔 到價警示',
                    body: `${t.code} 現價 ${ev.price} 已${t.condition === 'below' ? '跌破' : '突破'} ${t.price}`,
                });
            } else if (ev.message) {
                notify({
                    kind: 'ok',
                    title: `${KIND_ICON[t?.kind ?? 'stop']} ${t?.kind === 'take' ? '停利' : '停損'}觸發`,
                    body: ev.message,
                });
            }
            break;
        case 'fire_skipped':
        case 'fire_failed':
            notify({
                kind: 'err',
                title: ev.type === 'fire_failed' ? '觸價送單失敗' : '觸價未下單',
                body: ev.message ?? '',
            });
            break;
        case 'suspended':
            notify({
                kind: 'info',
                title: '⏸ 觸價單已暫停',
                body: ev.message ?? `${t?.code ?? ''} 已暫停`,
            });
            break;
        case 'oco_cancelled':
            notify({
                kind: 'info',
                title: 'OCO 互斥撤銷',
                body: `${t?.code ?? ''} 另一邊觸價單已自動移除`,
            });
            break;
        case 'bracket_armed':
            notify({
                kind: 'ok',
                title: '🛡 保護單已掛',
                body: `進場成交，停損/停利 OCO 已啟動${ev.price ? `（成交價 ${ev.price}）` : ''}`,
            });
            break;
        case 'imported':
            notify({
                kind: 'info',
                title: '觸價單已遷移至伺服器',
                body: `匯入 ${ev.imported ?? 0} 筆${ev.dropped ? `、捨棄 ${ev.dropped} 筆（他券商）` : ''}`,
            });
            break;
        default:
            break; // added/updated/removed/expired — silent, list refresh only
    }
}

// ---- one-time legacy migration (localStorage → server) ----

const LEGACY_KEY = 'sj-pro-triggers';
const IMPORTED_FLAG = 'sj-pro-triggers-imported';

async function migrateLegacy() {
    if (localStorage.getItem(IMPORTED_FLAG)) return;
    let legacy: {
        code: string;
        condition: 'below' | 'above';
        price: number;
        action: Action;
        quantity: number;
        kind: TriggerKind;
        group?: string;
        broker?: string;
    }[] = [];
    try {
        const raw = localStorage.getItem(LEGACY_KEY);
        if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) legacy = arr;
        }
    } catch {
        // corrupted — nothing to migrate
    }
    if (legacy.length === 0) {
        localStorage.setItem(IMPORTED_FLAG, '1');
        return;
    }
    const payload = [];
    for (const t of legacy) {
        try {
            const c = await ensureContract(t.code);
            payload.push({
                contract: {
                    security_type: c.security_type,
                    exchange: c.exchange,
                    code: c.code,
                },
                code: t.code,
                condition: t.condition,
                price: t.price,
                action: t.action,
                quantity: t.quantity,
                kind: t.kind,
                group: t.group,
                accountType:
                    c.security_type === 'FUT' || c.security_type === 'OPT'
                        ? ('F' as const)
                        : ('S' as const),
                legacy_broker: t.broker,
            });
        } catch {
            // unknown code — drop
        }
    }
    try {
        await apiPost('/api/v1/triggers/import', { triggers: payload });
        localStorage.setItem(IMPORTED_FLAG, '1');
        localStorage.removeItem(LEGACY_KEY);
        await refetch();
    } catch {
        // server down — retry next startup
    }
}

// ---- public API ----

let started = false;

export function startTriggerSync() {
    if (started) return;
    started = true;
    void refetch();
    void refetchStatus();
    void migrateLegacy();
    onTriggerEvent((raw) => {
        const ev = raw as TriggerEventMsg;
        toast(ev);
        void refetch();
        void refetchStatus();
    });
    onStreamReconnected(() => {
        // SSE gap — events may have been missed
        void refetch();
        void refetchStatus();
    });
    const timer = setInterval(() => void refetchStatus(), 15_000);
    if (typeof timer === 'object') timer.unref?.();
}

export interface NewTrigger {
    contract: ContractBase;
    condition: 'below' | 'above';
    price: number;
    action: Action;
    quantity: number;
    kind: TriggerKind;
    group?: string;
    expiry?: 'day' | 'gtc';
}

export async function addTrigger(input: NewTrigger): Promise<TriggerRow> {
    const isFut =
        input.contract.security_type === 'FUT' ||
        input.contract.security_type === 'OPT';
    const row = await apiPost<TriggerRow>('/api/v1/triggers', {
        contract: {
            security_type: input.contract.security_type,
            exchange: input.contract.exchange,
            code: input.contract.code,
        },
        code: input.contract.code,
        condition: input.condition,
        price: input.price,
        action: input.action,
        quantity: input.quantity,
        kind: input.kind,
        group: input.group,
        accountType: isFut ? 'F' : 'S',
        expiry: input.expiry,
    });
    rows = [...rows.filter((r) => r.id !== row.id), row];
    emit();
    const label =
        input.kind === 'stop'
            ? '⛔ 停損單已掛（伺服器）'
            : input.kind === 'take'
              ? '🎯 停利單已掛（伺服器）'
              : '🔔 警示已設（伺服器）';
    notify({
        kind: 'info',
        title: label,
        body: `${input.contract.code} 觸價 ${input.condition === 'below' ? '≤' : '≥'} ${input.price}${input.kind === 'alert' ? ' 時通知' : ` → 市價${input.action === 'Buy' ? '買' : '賣'} ${input.quantity}`}`,
    });
    return row;
}

export async function updateTriggerPrice(
    id: string,
    price: number,
): Promise<void> {
    const prev = rows;
    rows = rows.map((r) => (r.id === id ? { ...r, price } : r)); // optimistic
    emit();
    try {
        await apiPatch(`/api/v1/triggers/${id}`, { price });
    } catch (e) {
        rows = prev;
        emit();
        notify({
            kind: 'err',
            title: '改價失敗',
            body: e instanceof Error ? e.message : String(e),
        });
    }
}

export async function removeTrigger(id: string): Promise<void> {
    rows = rows.filter((r) => r.id !== id); // optimistic
    emit();
    try {
        await apiDelete(`/api/v1/triggers/${id}`);
    } catch {
        void refetch();
    }
}

export async function rearmTrigger(id: string): Promise<void> {
    try {
        await apiPost(`/api/v1/triggers/${id}/rearm`, {});
        await refetch();
    } catch (e) {
        notify({
            kind: 'err',
            title: '重新啟用失敗',
            body: e instanceof Error ? e.message : String(e),
        });
    }
}

export function useTriggers(): TriggerRow[] {
    return useSyncExternalStore(
        (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => rows,
    );
}

export function getTriggers(): TriggerRow[] {
    return rows;
}

export function useTriggerStatus(): {
    status: TriggerStatus | null;
    offline: boolean;
} {
    useSyncExternalStore(
        (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => `${statusFailed}:${status ? JSON.stringify(status) : ''}`,
    );
    return { status, offline: statusFailed };
}
