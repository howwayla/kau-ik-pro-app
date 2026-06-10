// src/lib/price-sync.ts — broadcast a "picked price" (chart hover/click,
// depth-ladder click) to order tickets of the same symbol. External store
// so high-frequency hover updates only re-render subscribed tickets.

import { useSyncExternalStore } from 'react';

export interface PickedPrice {
    code: string;
    price: number;
    seq: number;
}

let current: PickedPrice | null = null;
const listeners = new Set<() => void>();

export function setPickedPrice(code: string, price: number) {
    if (
        current &&
        current.code === code &&
        current.price === price
    ) {
        return; // dedupe hover spam at the same tick level
    }
    current = { code, price, seq: (current?.seq ?? 0) + 1 };
    listeners.forEach((l) => l());
}

export function usePickedPrice(code: string | null): PickedPrice | null {
    return useSyncExternalStore(
        (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => (current && code === current.code ? current : null),
    );
}
