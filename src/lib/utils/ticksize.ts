// src/lib/utils/ticksize.ts — TW market tick size tables

import type { ContractBase } from '../types/contract';

// TWSE/TPEX equities
function stockTick(price: number): number {
    if (price < 10) return 0.01;
    if (price < 50) return 0.05;
    if (price < 100) return 0.1;
    if (price < 500) return 0.5;
    if (price < 1000) return 1;
    return 5;
}

// ETFs (codes starting with 00)
function etfTick(price: number): number {
    return price < 50 ? 0.01 : 0.05;
}

export function tickSizeFor(contract: ContractBase, price: number): number {
    if (contract.security_type === 'FUT') return 1; // TXF/MXF/TMF index futures
    if (contract.security_type === 'OPT') return price >= 10 ? 1 : 0.1;
    if (contract.code.startsWith('00')) return etfTick(price);
    return stockTick(price);
}

export function roundToTick(contract: ContractBase, price: number): number {
    const tick = tickSizeFor(contract, price);
    const rounded = Math.round(price / tick) * tick;
    // avoid float dust (0.1 steps)
    return Number(rounded.toFixed(2));
}

export function stepPrice(
    contract: ContractBase,
    price: number,
    steps: number,
): number {
    let p = price;
    for (let i = 0; i < Math.abs(steps); i++) {
        const tick = tickSizeFor(contract, steps > 0 ? p : p - 0.0001);
        p = Number((p + (steps > 0 ? tick : -tick)).toFixed(2));
    }
    return p;
}
