import { useEffect, useMemo, useState } from 'react';
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
    const [version, setVersion] = useState(0);

    useEffect(ensureStream, []);

    useEffect(() => {
        const listener = () => setVersion((current) => current + 1);
        const unsubscribers = uniqueCodes.map((code) =>
            subscribeQuoteStore(code, listener),
        );
        return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    }, [uniqueCodes]);

    return useMemo(
        () =>
            Object.fromEntries(
                uniqueCodes.map((code) => [code, getQuote(code)]),
            ),
        [uniqueCodes, version],
    );
}
