// src/hooks/use-watchlist.ts — watched contracts: resolve contract info,
// subscribe Tick+BidAsk on the server, seed initial snapshot.
//
// Multiple server-side lists are supported (e.g. lists imported from the
// user's Fugle member watchlists via POST /api/v1/watchlist/import). The
// default list (nova-pro-v1) keeps the original local-first behavior;
// every other list treats the server copy as the source of truth, and
// add/remove writes through to whichever list is active.

import { useCallback, useEffect, useRef, useState } from 'react';
import { primeContract } from '../lib/contracts-cache';
import {
    createWatchlist,
    fetchContract,
    fetchSnapshots,
    fetchWatchlists,
    subscribeQuote,
    syncWatchlist,
    type ServerWatchlist,
} from '../lib/backend';
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
const ACTIVE_KEY = 'sj-pro-watchlist-active';
const SERVER_LIST_NAME = 'nova-pro-v1';

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
    const [lists, setLists] = useState<ServerWatchlist[]>([]);
    const [activeListId, setActiveListId] = useState<string | null>(null);
    const subscribed = useRef(new Set<string>());
    const initStarted = useRef(false);
    const initDone = useRef(false);
    const serverListId = useRef<string | null>(null);
    const activeIsDefault = useRef(true);
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

    /** load a server list's contents into the panel (server is the truth) */
    const loadList = useCallback(
        async (list: ServerWatchlist) => {
            initDone.current = false;
            setLoading(true);
            setItems([]);
            serverListId.current = list.id;
            activeIsDefault.current = list.name === SERVER_LIST_NAME;
            setActiveListId(list.id);
            localStorage.setItem(ACTIVE_KEY, list.id);
            for (const c of list.contracts) {
                try {
                    await addSymbol(c.code, c.security_type);
                } catch {
                    // unknown code — skip
                }
            }
            initDone.current = true;
            setLoading(false);
        },
        [addSymbol],
    );

    const selectList = useCallback(
        async (id: string) => {
            if (id === serverListId.current) return;
            let list = lists.find((l) => l.id === id);
            if (!list) {
                const fresh = await fetchWatchlists().catch(() => []);
                setLists(fresh);
                list = fresh.find((l) => l.id === id);
            }
            if (list) await loadList(list);
        },
        [lists, loadList],
    );

    const refreshLists = useCallback(async () => {
        const fresh = await fetchWatchlists().catch(() => null);
        if (fresh) setLists(fresh);
        return fresh ?? lists;
    }, [lists]);

    // persist only after the initial load finished — writing during the
    // load loop races with StrictMode double-mount and truncates the list
    useEffect(() => {
        if (!initDone.current) return;
        // the localStorage mirror is the offline fallback for the DEFAULT
        // list only — imported lists live on the server
        if (activeIsDefault.current) {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify(
                    items.map((i) => ({
                        code: i.contract.code,
                        type: i.contract.security_type,
                    })),
                ),
            );
        }
        // write-through to whichever server list is active
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
                        setActiveListId(wl.id);
                    })
                    .catch(() => undefined);
            }
        }, 2000);
    }, [items]);

    useEffect(() => {
        if (initStarted.current) return;
        initStarted.current = true;
        (async () => {
            let serverLists: ServerWatchlist[] = [];
            try {
                serverLists = await fetchWatchlists();
                setLists(serverLists);
            } catch {
                // offline from server watchlists — local copy is fine
            }

            // resume the last-selected list when it still exists and is
            // not the default — server copy is the truth for those
            const lastActive = localStorage.getItem(ACTIVE_KEY);
            const resumed = serverLists.find((l) => l.id === lastActive);
            if (resumed && resumed.name !== SERVER_LIST_NAME) {
                await loadList(resumed);
                return;
            }

            // default-list path: original local-first behavior (cloud is a
            // seed only when local storage is empty)
            const local = loadSaved();
            let saved = local;
            const mine = serverLists.find((l) => l.name === SERVER_LIST_NAME);
            if (mine) {
                serverListId.current = mine.id;
                setActiveListId(mine.id);
                const hasLocal = !!localStorage.getItem(STORAGE_KEY);
                if (!hasLocal && mine.contracts.length > 0) {
                    saved = mine.contracts.map((c) => ({
                        code: c.code,
                        type: c.security_type,
                    }));
                }
            }
            activeIsDefault.current = true;
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
    }, [addSymbol, loadList]);

    return {
        items,
        loading,
        addSymbol,
        removeSymbol,
        lists,
        activeListId,
        selectList,
        refreshLists,
    };
}
