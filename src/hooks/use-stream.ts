// src/hooks/use-stream.ts — bind components to the SSE quote store

import { useEffect, useSyncExternalStore } from 'react';
import {
    ensureStream,
    getQuote,
    getStreamStatus,
    subscribeQuoteStore,
    subscribeStatusStore,
} from '../lib/stream';
import type { QuoteState, StreamStatus } from '../lib/stream';

export function useStreamStatus(): StreamStatus {
    useEffect(ensureStream, []);
    return useSyncExternalStore(subscribeStatusStore, getStreamStatus);
}

export function useQuote(code: string | null): QuoteState | undefined {
    useEffect(ensureStream, []);
    return useSyncExternalStore(
        (listener) =>
            code ? subscribeQuoteStore(code, listener) : () => undefined,
        () => (code ? getQuote(code) : undefined),
    );
}
