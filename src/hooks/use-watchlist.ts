// src/hooks/use-watchlist.ts — watched contracts: resolve contract info,
// subscribe Tick+BidAsk on the server, seed initial snapshot.

import { useCallback, useEffect, useRef, useState } from 'react';
import { primeContract } from '../lib/contracts-cache';
import {
    createWatchlist,
    fetchContract,
    fetchSnapshots,
    fetchWatchlists,
    subscribeQuote,
    syncWatchlist,
} from '../lib/shioaji';
import { registerCodeAlias } from '../lib/stream';
import type { ContractInfo, SecurityType } from '../lib/types/contract';
import type { Snapshot } from '../lib/types/market';

export interface WatchItem {
    contract: ContractInfo;
    snapshot?: Snapshot;
}

const DEFAULT_SYMBOLS: { code: string; type: SecurityType }[] = [
    { code: '2330', type: 'STK' },
    { code: '2317', type: 'STK' },
    { code: '2454', type: 'STK' },
    { code: '2603', type: 'STK' },
    { code: '0050', type: 'STK' },
    { code: 'TXFR1', type: 'FUT' },
];

const STORAGE_KEY = 'sj-pro-watchlist';
const SERVER_LIST_NAME = 'shioaji-pro-v2';

function loadSaved(): { code: string; type: SecurityType }[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
    } catch {
        // fall through to defaults
    }
    return DEFAULT_SYMBOLS;
}

export function useWatchlist() {
    const [items, setItems] = useState<WatchItem[]>([]);
    const [loading, setLoading] = useState(true);
    const subscribed = useRef(new Set<string>());
    const initStarted = useRef(false);
    const initDone = useRef(false);
    const serverListId = useRef<string | null>(null);
    const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const addSymbol = useCallback(
        async (code: string, type: SecurityType = 'STK') => {
            const contract = await fetchContract(code, type);
            if (contract.target_code) {
                registerCodeAlias(contract.target_code, contract.code);
            }
            primeContract(contract);
            setItems((prev) =>
                prev.some((i) => i.contract.code === contract.code)
                    ? prev
                    : [...prev, { contract }],
            );
            if (!subscribed.current.has(contract.code)) {
                subscribed.current.add(contract.code);
                await Promise.allSettled([
                    subscribeQuote(contract, 'Tick'),
                    subscribeQuote(contract, 'BidAsk'),
                ]);
            }
            fetchSnapshots([contract])
                .then(([snap]) =>
                    setItems((prev) =>
                        prev.map((i) =>
                            i.contract.code === contract.code
                                ? { ...i, snapshot: snap }
                                : i,
                        ),
                    ),
                )
                .catch(() => undefined);
            return contract;
        },
        [],
    );

    const removeSymbol = useCallback((code: string) => {
        setItems((prev) => prev.filter((i) => i.contract.code !== code));
    }, []);

    // persist only after the initial load finished — writing during the
    // load loop races with StrictMode double-mount and truncates the list
    useEffect(() => {
        if (!initDone.current) return;
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(
                items.map((i) => ({
                    code: i.contract.code,
                    type: i.contract.security_type,
                })),
            ),
        );
        // best-effort cloud sync to the server watchlist
        if (syncTimer.current) clearTimeout(syncTimer.current);
        syncTimer.current = setTimeout(() => {
            const contracts = items.map((i) => i.contract);
            if (serverListId.current) {
                syncWatchlist(serverListId.current, contracts).catch(
                    () => undefined,
                );
            } else {
                createWatchlist(SERVER_LIST_NAME, contracts)
                    .then((wl) => {
                        serverListId.current = wl.id;
                    })
                    .catch(() => undefined);
            }
        }, 2000);
    }, [items]);

    useEffect(() => {
        if (initStarted.current) return;
        initStarted.current = true;
        (async () => {
            const local = loadSaved();
            let saved = local;
            // cloud list is a seed when local storage is empty; local wins
            // otherwise (server 1.5.2 watchlist update routes are broken, so
            // the cloud copy can be stale)
            try {
                const lists = await fetchWatchlists();
                const mine = lists.find((l) => l.name === SERVER_LIST_NAME);
                if (mine) {
                    serverListId.current = mine.id;
                    const hasLocal = !!localStorage.getItem(STORAGE_KEY);
                    if (!hasLocal && mine.contracts.length > 0) {
                        saved = mine.contracts.map((c) => ({
                            code: c.code,
                            type: c.security_type,
                        }));
                    }
                }
            } catch {
                // offline from server watchlists — local copy is fine
            }
            for (const s of saved) {
                try {
                    await addSymbol(s.code, s.type);
                } catch {
                    // unknown code — skip
                }
            }
            initDone.current = true;
            setLoading(false);
        })();
    }, [addSymbol]);

    return { items, loading, addSymbol, removeSymbol };
}
