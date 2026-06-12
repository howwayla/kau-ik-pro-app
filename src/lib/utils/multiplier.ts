// src/lib/utils/multiplier.ts — TWD per (1 point × 1 unit) per instrument.
// Used for live P&L estimates in the UI; the server keeps its own copy
// for paper-trading bookkeeping.

export function contractMultiplier(c: {
    security_type: string | null;
    code: string;
}): number {
    if (c.security_type === 'STK') return 1000; // 1 張 = 1000 股
    if (c.security_type === 'IND') return 1;
    if (c.code.startsWith('TXO')) return 50;
    if (c.code.startsWith('MXF')) return 50;
    if (c.code.startsWith('TMF')) return 10;
    if (c.security_type === 'FUT' || c.security_type === 'OPT') return 200;
    return 1;
}
