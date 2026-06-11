// src/lib/trade.ts — one-shot order helper + in-app notification channel

import { getCapabilities } from './capabilities';
import { checkOrderAllowed } from './risk';
import {
    cancelOrder,
    fetchTrades,
    placeFuturesOrder,
    placeStockOrder,
} from './backend';
import type { ContractBase } from './types/contract';
import {
    ACTIVE_ORDER_STATUSES,
    type Action,
    type StockOrderLot,
    type Trade,
} from './types/order';

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
    opts?: {
        bypassRisk?: boolean; // protective exits skip risk gating
        orderLot?: StockOrderLot; // e.g. IntradayOdd for odd-lot closes
    },
): Promise<Trade> {
    if (!opts?.bypassRisk) {
        // risk caps are denominated in 張 — odd-lot orders carry 股
        const riskQty =
            opts?.orderLot === 'IntradayOdd' || opts?.orderLot === 'Odd'
                ? quantity / 1000
                : quantity;
        const blocked = checkOrderAllowed(riskQty);
        if (blocked) throw new Error(blocked);
    }
    const market = price === null;
    return sendOrder(contract, action, price, quantity, market, opts?.orderLot);
}

async function sendOrder(
    contract: ContractBase,
    action: Action,
    price: number | null,
    quantity: number,
    market: boolean,
    orderLot: StockOrderLot = 'Common',
): Promise<Trade> {
    if (isFuturesContract(contract) && !getCapabilities().futures_trading) {
        throw new Error('目前券商不支援期貨/選擇權下單（期權僅供行情顯示）');
    }
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
              // 盤中零股僅收 ROD 限價
              order_type: market && orderLot === 'Common' ? 'IOC' : 'ROD',
              order_lot: orderLot,
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
