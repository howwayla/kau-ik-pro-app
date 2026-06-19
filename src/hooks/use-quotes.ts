import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
    ensureStream,
    getQuote,
    subscribeQuoteStore,
    type QuoteState,
} from '../lib/stream';

function uniqueSorted(codes: readonly string[]): string[] {
    return [...new Set(codes.filter(Boolean))].sort();
}

export function useQuotes(
    codes: readonly string[],
): Record<string, QuoteState | undefined> {
    const key = useMemo(() => uniqueSorted(codes).join(','), [codes]);
    const uniqueCodes = useMemo(() => key.split(',').filter(Boolean), [key]);
    const store = useMemo(() => {
        let cachedQuotes: (QuoteState | undefined)[] | undefined;
        let cachedSnapshot: Record<string, QuoteState | undefined> | undefined;

        return {
            subscribe(listener: () => void) {
                const unsubscribers = uniqueCodes.map((code) =>
                    subscribeQuoteStore(code, listener),
                );
                return () =>
                    unsubscribers.forEach((unsubscribe) => unsubscribe());
            },
            getSnapshot() {
                const nextQuotes = uniqueCodes.map((code) => getQuote(code));
                const unchanged =
                    cachedQuotes?.length === nextQuotes.length &&
                    cachedQuotes.every(
                        (quote, index) => quote === nextQuotes[index],
                    );

                if (unchanged && cachedSnapshot) return cachedSnapshot;

                cachedQuotes = nextQuotes;
                cachedSnapshot = Object.fromEntries(
                    uniqueCodes.map((code, index) => [
                        code,
                        nextQuotes[index],
                    ]),
                );
                return cachedSnapshot;
            },
        };
    }, [uniqueCodes]);

    useEffect(ensureStream, []);

    return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
