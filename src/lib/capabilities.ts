// src/lib/capabilities.ts — server capability flags (from GET /api/v1/info).
// The active trading provider decides what the UI may offer: e.g. Taishin
// Nova is stocks-only, so futures/options order UI is hidden when
// futures_trading is false. Defaults to permissive until /info loads.

import { useSyncExternalStore } from 'react';

export interface ServerCapabilities {
    futures_trading: boolean;
    /** broker-side condition orders (L1 protection) — fubon only */
    condition_orders?: boolean;
}

let caps: ServerCapabilities = { futures_trading: true };
const listeners = new Set<() => void>();

export function setCapabilities(next: ServerCapabilities | undefined) {
    if (!next) return;
    caps = next;
    listeners.forEach((l) => l());
}

export function getCapabilities(): ServerCapabilities {
    return caps;
}

export function useCapabilities(): ServerCapabilities {
    return useSyncExternalStore(
        (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => caps,
    );
}
