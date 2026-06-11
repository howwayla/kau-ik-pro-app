// src/lib/privacy.ts — privacy mode for screenshots / screen sharing.
// When enabled, elements tagged with the SENSITIVE class are blurred via
// CSS ([data-privacy='on'] in index.css). Masks portfolio amounts,
// quantities and P&L — market data (prices/quotes) stays visible.

import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'sj-pro-privacy';

/** className for elements that must be masked in privacy mode */
export const SENSITIVE = 'privacy-sensitive';

let enabled = false;
try {
    enabled = localStorage.getItem(STORAGE_KEY) === 'on';
} catch {
    // storage unavailable — default off
}

const listeners = new Set<() => void>();

function apply(): void {
    document.body.dataset.privacy = enabled ? 'on' : 'off';
}
apply();

export function setPrivacy(on: boolean): void {
    enabled = on;
    try {
        localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch {
        // best effort
    }
    apply();
    listeners.forEach((l) => l());
}

export function usePrivacy(): boolean {
    return useSyncExternalStore(
        (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => enabled,
    );
}
