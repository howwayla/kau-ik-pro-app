// src/lib/contracts-cache.ts — global contract cache for pinned panels.
// Resolves a code to ContractInfo (STK first, FUT fallback), subscribes
// its quote streams once, and exposes a useSyncExternalStore hook.

import { useSyncExternalStore } from 'react';
import { fetchContract, subscribeQuote, unsubscribeQuote } from './backend';
import { registerCodeAlias } from './stream';
import type { ContractInfo, SecurityType } from './types/contract';

const cache = new Map<string, ContractInfo>();
const pending = new Map<string, Promise<ContractInfo>>();
const subscribed = new Set<string>();
// 「暫看」訂閱（點排行/搜尋只檢視、未加入追蹤）：可被回收。watchlist/釘選
// 透過 primeContract / claimContract 認領後即從此集合移除，cleanup 便不會退訂。
const temporary = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
    listeners.forEach((l) => l());
}

export function getCachedContract(code: string): ContractInfo | undefined {
    return cache.get(code);
}

export function primeContract(contract: ContractInfo) {
    if (!cache.has(contract.code)) {
        cache.set(contract.code, contract);
        emit();
    }
    subscribed.add(contract.code); // watchlist already subscribed it
    temporary.delete(contract.code); // 永久持有 — 不再是暫看,別被回收
}

/** 標記 code 為永久持有（釘選面板等）→ 其暫看訂閱不再被 cleanup 回收 */
export function claimContract(code: string) {
    temporary.delete(code);
}

/**
 * 暫看用：解析 + 訂閱，回傳 cleanup() 供「切走即退訂」，避免點排行/搜尋的
 * 標的永久累積 live 訂閱。若該 code 已被永久訂閱者（watchlist/釘選）持有,
 * 則不接管其生命週期（cleanup 為 no-op,絕不誤退已追蹤標的的行情）。
 */
export async function ensureContractTemporary(
    code: string,
): Promise<{ contract: ContractInfo; cleanup: () => void }> {
    const ownedPermanently = subscribed.has(code) && !temporary.has(code);
    const contract = await ensureContract(code);
    if (ownedPermanently) return { contract, cleanup: () => {} };
    temporary.add(code);
    const cleanup = () => {
        if (!temporary.has(code)) return; // 已升級為永久（加入追蹤/釘選）
        temporary.delete(code);
        subscribed.delete(code);
        void unsubscribeQuote(contract, 'Tick');
        void unsubscribeQuote(contract, 'BidAsk');
    };
    return { contract, cleanup };
}

export async function ensureContract(
    code: string,
    type?: SecurityType,
): Promise<ContractInfo> {
    const hit = cache.get(code);
    if (hit) return hit;
    const inflight = pending.get(code);
    if (inflight) return inflight;

    const task = (async () => {
        let contract: ContractInfo;
        if (type) {
            contract = await fetchContract(code, type);
        } else {
            try {
                contract = await fetchContract(code, 'STK');
            } catch {
                contract = await fetchContract(code, 'FUT');
            }
        }
        cache.set(code, contract);
        if (contract.target_code) {
            registerCodeAlias(contract.target_code, contract.code);
        }
        if (!subscribed.has(contract.code)) {
            subscribed.add(contract.code);
            await Promise.allSettled([
                subscribeQuote(contract, 'Tick'),
                subscribeQuote(contract, 'BidAsk'),
            ]);
        }
        emit();
        return contract;
    })();
    pending.set(code, task);
    try {
        return await task;
    } finally {
        pending.delete(code);
    }
}

export function useContract(code: string | null): ContractInfo | undefined {
    return useSyncExternalStore(
        (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => (code ? cache.get(code) : undefined),
    );
}
