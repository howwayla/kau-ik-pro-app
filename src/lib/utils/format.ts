// src/lib/utils/format.ts

export function fmtPrice(v: number | string | undefined, digits?: number) {
    if (v === undefined || v === null || v === '') return '—';
    const n = Number(v);
    if (Number.isNaN(n)) return '—';
    const d = digits ?? (Math.abs(n) >= 500 ? 0 : 2);
    return n.toLocaleString('en-US', {
        minimumFractionDigits: d,
        maximumFractionDigits: Math.max(d, 2),
    });
}

export function fmtInt(v: number | undefined) {
    if (v === undefined || v === null) return '—';
    return v.toLocaleString('en-US');
}

export function fmtSigned(v: number | string | undefined, digits = 2) {
    if (v === undefined || v === null || v === '') return '—';
    const n = Number(v);
    if (Number.isNaN(n)) return '—';
    const s = n.toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    });
    return n > 0 ? `+${s}` : s;
}

export function fmtPct(v: number | string | undefined) {
    if (v === undefined || v === null || v === '') return '—';
    const n = Number(v);
    if (Number.isNaN(n)) return '—';
    return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export function fmtMoney(v: number | undefined) {
    if (v === undefined || v === null) return '—';
    return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

// direction: TW convention — red up / green down. Returns 1 / -1 / 0.
export function dirOf(v: number | string | undefined): 1 | -1 | 0 {
    const n = Number(v ?? 0);
    if (Number.isNaN(n) || n === 0) return 0;
    return n > 0 ? 1 : -1;
}
