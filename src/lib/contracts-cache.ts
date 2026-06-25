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
// 「暫看」訂閱（點排行/搜尋只檢視、未加入追蹤）：可被回收。
const temporary = new Set<string>();
// 永久持有（watchlist 加入 / 釘選）的權威集合 — 由 primeContract / claimContract
// 寫入。ensureContractTemporary 在 await 之後、以及 cleanup 當下都查它,
// 確保「曾是/已成為永久」的標的絕不被暫看 cleanup 退訂（含 await 期間才被認領的 TOCTOU）。
const permanent = new Set<string>();
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
    permanent.add(contract.code); // 永久持有 — 不再是暫看,別被回收
    temporary.delete(contract.code);
}

/** 標記 code 為永久持有（釘選面板等）→ 其暫看訂閱不再被 cleanup 回收 */
export function claimContract(code: string) {
    permanent.add(code);
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
    const contract = await ensureContract(code);
    // await 之後才判定：解析期間可能已被 primeContract/claimContract 認領為永久
    // （TOCTOU）。已永久持有就不接管其生命週期，cleanup 為 no-op。
    if (permanent.has(code)) return { contract, cleanup: () => {} };
    temporary.add(code);
    const cleanup = () => {
        // 認領後（加入追蹤/釘選）或非本次暫看持有 → 不退訂
        if (permanent.has(code) || !temporary.has(code)) return;
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
