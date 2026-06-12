// server/src/providers/fugle/symbols.ts — symbol translation between the
// app's shioaji-style codes and Fugle marketdata symbols.

/** app code ↔ fugle symbol for indices */
const INDEX_MAP: Record<string, string> = {
    '001': 'IX0001', // 加權指數
    '101': 'IX0043', // 櫃買指數
};

export function toFugleSymbol(code: string): string {
    return INDEX_MAP[code] ?? code;
}

export function fromFugleSymbol(symbol: string): string {
    for (const [code, sym] of Object.entries(INDEX_MAP)) {
        if (sym === symbol) return code;
    }
    return symbol;
}

export function isContinuousAlias(code: string): boolean {
    return /^(TXF|MXF|TMF|EXF|FXF)R[12]$/.test(code);
}

export function aliasPrefix(code: string): string {
    return code.slice(0, 3);
}

/** TAIFEX month letters: futures/calls A–L, puts M–X */
export function parseTaifexOption(
    symbol: string,
): { strike: number; right: 'C' | 'P'; month: number; yearDigit: number } | null {
    const m = /^([A-Z]{3})(\d{3,5})([A-X])(\d)$/.exec(symbol);
    if (!m) return null;
    const letter = m[3]!.charCodeAt(0) - 64; // A=1
    const put = letter > 12;
    return {
        strike: Number(m[2]),
        right: put ? 'P' : 'C',
        month: put ? letter - 12 : letter,
        yearDigit: Number(m[4]),
    };
}

/** delivery month "YYYYMM" from a TAIFEX month letter + year digit */
export function deliveryMonthOf(month: number, yearDigit: number, now = new Date()): string {
    // resolve the decade: pick the year matching the digit closest to now
    const base = Math.floor(now.getFullYear() / 10) * 10 + yearDigit;
    const candidates = [base - 10, base, base + 10];
    let year = base;
    let best = Infinity;
    for (const y of candidates) {
        const diff = Math.abs(y - now.getFullYear());
        if (diff < best) {
            best = diff;
            year = y;
        }
    }
    return `${year}${String(month).padStart(2, '0')}`;
}
