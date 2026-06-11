// src/lib/regulatory.ts — 處置/注意股 flags, fetched once and refreshed
// hourly (the lists change at most daily). Shared by the watchlist badges
// and the chips card.

import { useSyncExternalStore } from 'react';
import { apiGet } from './api';

export type RegulatoryFlag = 'punish' | 'attention' | null;

let punish = new Set<string>();
let attention = new Set<string>();
let started = false;
let version = 0;
const listeners = new Set<() => void>();

async function refresh() {
    try {
        const res = await apiGet<{ code: string[]; attention?: string[] }>(
            '/api/v1/data/regulatory_punish',
        );
        punish = new Set(res.code ?? []);
        attention = new Set(res.attention ?? []);
        version += 1;
        listeners.forEach((l) => l());
    } catch {
        // keep previous lists — flags are informational
    }
}

function ensureStarted() {
    if (started) return;
    started = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 60 * 60_000);
    if (typeof timer === 'object') timer.unref?.();
}

export function getRegulatoryFlag(code: string): RegulatoryFlag {
    if (punish.has(code)) return 'punish';
    if (attention.has(code)) return 'attention';
    return null;
}

export function useRegulatoryFlag(code: string): RegulatoryFlag {
    ensureStarted();
    useSyncExternalStore(
        (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => version,
    );
    return getRegulatoryFlag(code);
}
