// src/lib/position-actions.ts — close / reverse a position at market.
// Extracted from bottom-dock so the chart's position overlay can reuse it
// (odd-lot handling included: 盤中零股僅收限價，用漲跌停價保證成交).

import { ensureContract } from './contracts-cache';
import { notify, placeQuickOrder } from './trade';
import type { Position } from './types/portfolio';

export async function closeOrReverse(
    p: Position,
    mode: 'close' | 'reverse',
): Promise<void> {
    try {
        const contract = await ensureContract(p.code);
        const exit = p.direction === 'Buy' ? 'Sell' : 'Buy';
        const isStock = contract.security_type === 'STK';
        // 股票持倉的 quantity 是「張」，可能含零股小數（0.407 = 407 股）
        const wholeLots = isStock ? Math.floor(p.quantity + 1e-9) : p.quantity;
        const oddShares = isStock
            ? Math.round((p.quantity - wholeLots) * 1000)
            : 0;
        if (mode === 'reverse' && oddShares > 0) {
            throw new Error(
                '反手僅支援整張部位（零股不可賣超）— 請先平倉零股',
            );
        }
        const parts: string[] = [];
        if (wholeLots > 0) {
            const qty = mode === 'close' ? wholeLots : wholeLots * 2;
            const trade = await placeQuickOrder(contract, exit, null, qty);
            parts.push(
                `整股市價${exit === 'Buy' ? '買' : '賣'} ${qty} 張 (${trade.status.status})`,
            );
        }
        if (oddShares > 0) {
            const price =
                exit === 'Sell' ? contract.limit_down : contract.limit_up;
            if (!price || price <= 0) {
                throw new Error('取不到漲跌停價，零股平倉請改用下單面板');
            }
            const trade = await placeQuickOrder(contract, exit, price, oddShares, {
                orderLot: 'IntradayOdd',
            });
            parts.push(
                `零股限價${exit === 'Buy' ? '買' : '賣'} ${oddShares} 股 @${price} (${trade.status.status})`,
            );
        }
        if (parts.length === 0) {
            throw new Error('持倉數量為 0，無單可下');
        }
        notify({
            kind: 'ok',
            title: mode === 'close' ? '⏹ 平倉單已送出' : '🔄 反手單已送出',
            body: `${p.code} ${parts.join('；')}`,
        });
    } catch (e) {
        notify({
            kind: 'err',
            title: mode === 'close' ? '平倉失敗' : '反手失敗',
            body: e instanceof Error ? e.message : String(e),
        });
        throw e;
    }
}
