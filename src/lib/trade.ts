// src/lib/trade.ts — one-shot order helper + in-app notification channel

import { checkOrderAllowed } from './risk';
import {
    cancelOrder,
    fetchTrades,
    placeFuturesOrder,
    placeStockOrder,
} from './shioaji';
import type { ContractBase } from './types/contract';
import { ACTIVE_ORDER_STATUSES, type Action, type Trade } from './types/order';

export interface AppNotice {
    kind: 'ok' | 'err' | 'info';
    title: string;
    body: string;
}

const noticeListeners = new Set<(n: AppNotice) => void>();

export function onNotice(listener: (n: AppNotice) => void) {
    noticeListeners.add(listener);
    return () => {
        noticeListeners.delete(listener);
    };
}

export function notify(n: AppNotice) {
    noticeListeners.forEach((l) => l(n));
}

export function isFuturesContract(contract: ContractBase): boolean {
    return (
        contract.security_type === 'FUT' || contract.security_type === 'OPT'
    );
}

// price === null → market order (futures MKT/IOC, stocks MKT/IOC)
export async function placeQuickOrder(
    contract: ContractBase,
    action: Action,
    price: number | null,
    quantity: number,
    opts?: { bypassRisk?: boolean }, // protective exits skip risk gating
): Promise<Trade> {
    if (!opts?.bypassRisk) {
        const blocked = checkOrderAllowed(quantity);
        if (blocked) throw new Error(blocked);
    }
    const market = price === null;
    return sendOrder(contract, action, price, quantity, market);
}

async function sendOrder(
    contract: ContractBase,
    action: Action,
    price: number | null,
    quantity: number,
    market: boolean,
): Promise<Trade> {
    const trade = isFuturesContract(contract)
        ? await placeFuturesOrder(contract, {
              action,
              price: price ?? 0,
              quantity,
              price_type: market ? 'MKT' : 'LMT',
              order_type: market ? 'IOC' : 'ROD',
              octype: 'Auto',
          })
        : await placeStockOrder(contract, {
              action,
              price: price ?? 0,
              quantity,
              price_type: market ? 'MKT' : 'LMT',
              order_type: market ? 'IOC' : 'ROD',
              order_lot: 'Common',
          });
    return trade;
}

// cancel every working order across stock + futures accounts
export async function cancelAllOrders(): Promise<number> {
    const [st, fu] = await Promise.allSettled([
        fetchTrades('S'),
        fetchTrades('F'),
    ]);
    const all: Trade[] = [
        ...(st.status === 'fulfilled' ? st.value : []),
        ...(fu.status === 'fulfilled' ? fu.value : []),
    ];
    const working = all.filter((t) =>
        ACTIVE_ORDER_STATUSES.has(t.status.status),
    );
    const results = await Promise.allSettled(
        working.map((t) => cancelOrder(t.order.id)),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    notify({
        kind: ok === working.length ? 'ok' : 'err',
        title: '🚨 全部刪單',
        body: `已送出 ${ok}/${working.length} 筆刪單`,
    });
    return ok;
}
