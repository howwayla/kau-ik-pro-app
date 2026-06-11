// src/hooks/use-poll.ts — poll an async fetcher on an interval, with a
// manual refresh trigger (e.g. after an order event). Pass intervalMs
// null to fetch once on mount and only refresh on demand — used for
// broker account data, whose APIs are rate-limited and whose freshness
// is driven by order events instead of polling.

import { useCallback, useEffect, useRef, useState } from 'react';

export function usePoll<T>(
    fetcher: () => Promise<T>,
    intervalMs: number | null,
): { data: T | undefined; error: string | null; refresh: () => void } {
    const [data, setData] = useState<T>();
    const [error, setError] = useState<string | null>(null);
    const fetcherRef = useRef(fetcher);
    fetcherRef.current = fetcher;

    const run = useCallback(async () => {
        try {
            const d = await fetcherRef.current();
            setData(d);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    }, []);

    useEffect(() => {
        run();
        if (intervalMs === null) return;
        const t = setInterval(run, intervalMs);
        return () => clearInterval(t);
    }, [run, intervalMs]);

    return { data, error, refresh: run };
}
