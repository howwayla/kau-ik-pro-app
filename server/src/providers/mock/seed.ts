// server/src/providers/mock/seed.ts — simulated instrument universe:
// TSE/OTC stocks (covers the default watchlist), TAIEX index, TXF/MXF
// front-month futures with continuous-month aliases, and a TXO chain.

import type {
    Exchange,
    OptContract,
    SecurityType,
} from '../../types/dto.ts';

export interface SeedInstrument {
    code: string;
    name: string;
    exchange: Exchange;
    security_type: SecurityType;
    reference: number;
    category: string;
    /** TWD per 1 unit of (price × quantity): stocks 1000 (張), TXF 200, MXF 50, TXO 50 */
    multiplier: number;
    target_code: string | null;
}

const STOCKS: [string, string, Exchange, number][] = [
    ['2330', '台積電', 'TSE', 1100],
    ['2317', '鴻海', 'TSE', 185],
    ['2454', '聯發科', 'TSE', 1300],
    ['2603', '長榮', 'TSE', 210],
    ['0050', '元大台灣50', 'TSE', 200],
    ['2412', '中華電', 'TSE', 125],
    ['2881', '富邦金', 'TSE', 95],
    ['2882', '國泰金', 'TSE', 68],
    ['2891', '中信金', 'TSE', 38.5],
    ['2308', '台達電', 'TSE', 420],
    ['2303', '聯電', 'TSE', 52.3],
    ['2002', '中鋼', 'TSE', 24.15],
    ['1301', '台塑', 'TSE', 45.2],
    ['1303', '南亞', 'TSE', 42.8],
    ['2886', '兆豐金', 'TSE', 42.5],
    ['2884', '玉山金', 'TSE', 28.9],
    ['3008', '大立光', 'TSE', 2300],
    ['2382', '廣達', 'TSE', 290],
    ['3231', '緯創', 'TSE', 110],
    ['2357', '華碩', 'TSE', 650],
    ['2327', '國巨', 'TSE', 700],
    ['3034', '聯詠', 'TSE', 520],
    ['2379', '瑞昱', 'TSE', 480],
    ['3017', '奇鋐', 'TSE', 800],
    ['2376', '技嘉', 'TSE', 290],
    ['1216', '統一', 'TSE', 78.5],
    ['2207', '和泰車', 'TSE', 620],
    ['2912', '統一超', 'TSE', 280],
    ['6505', '台塑化', 'TSE', 80.1],
    ['9910', '豐泰', 'TSE', 120],
    ['6488', '環球晶', 'OTC', 520],
    ['5483', '中美晶', 'OTC', 180],
    ['3105', '穩懋', 'OTC', 130],
    ['8069', '元太', 'OTC', 250],
    ['5347', '世界', 'OTC', 95.5],
    ['3529', '力旺', 'OTC', 2200],
    ['6180', '橘子', 'OTC', 60.2],
    ['8299', '群聯', 'OTC', 550],
];

export const INDEX_REFERENCE = 23000;
const TXF_BASIS = 50; // mock futures premium over spot

/** TAIFEX month letter: calls/futures A–L, puts M–X */
function monthLetter(month: number, put = false): string {
    return String.fromCharCode(64 + month + (put ? 12 : 0));
}

function thirdWednesday(year: number, month: number): Date {
    const first = new Date(year, month - 1, 1);
    const offset = (3 - first.getDay() + 7) % 7; // first Wednesday
    return new Date(year, month - 1, 1 + offset + 14);
}

export interface FuturesMonth {
    year: number;
    month: number;
    letter: string;
    deliveryDate: Date;
    deliveryMonth: string; // YYYYMM
}

/** front month (rolls to next month after the third Wednesday) plus the month after */
export function frontMonths(now = new Date()): [FuturesMonth, FuturesMonth] {
    let year = now.getFullYear();
    let month = now.getMonth() + 1;
    if (now > thirdWednesday(year, month)) {
        month += 1;
        if (month > 12) {
            month = 1;
            year += 1;
        }
    }
    const mk = (y: number, m: number): FuturesMonth => ({
        year: y,
        month: m,
        letter: monthLetter(m),
        deliveryDate: thirdWednesday(y, m),
        deliveryMonth: `${y}${String(m).padStart(2, '0')}`,
    });
    const next =
        month === 12 ? mk(year + 1, 1) : mk(year, month + 1);
    return [mk(year, month), next];
}

function futCode(prefix: string, fm: FuturesMonth): string {
    return `${prefix}${fm.letter}${fm.year % 10}`;
}

export function buildInstruments(now = new Date()): Map<string, SeedInstrument> {
    const map = new Map<string, SeedInstrument>();
    for (const [code, name, exchange, reference] of STOCKS) {
        map.set(code, {
            code,
            name,
            exchange,
            security_type: 'STK',
            reference,
            category: '',
            multiplier: 1000,
            target_code: null,
        });
    }
    map.set('001', {
        code: '001',
        name: '加權指數',
        exchange: 'TSE',
        security_type: 'IND',
        reference: INDEX_REFERENCE,
        category: '',
        multiplier: 1,
        target_code: null,
    });
    map.set('101', {
        code: '101',
        name: '櫃買指數',
        exchange: 'OTC',
        security_type: 'IND',
        reference: 420,
        category: '',
        multiplier: 1,
        target_code: null,
    });

    const [front] = frontMonths(now);
    const futRef = INDEX_REFERENCE + TXF_BASIS;
    for (const [prefix, name, mult] of [
        ['TXF', '臺股期貨', 200],
        ['MXF', '小型臺指', 50],
    ] as const) {
        const actual = futCode(prefix, front);
        map.set(actual, {
            code: actual,
            name: `${name}${front.deliveryMonth}`,
            exchange: 'TAIFEX',
            security_type: 'FUT',
            reference: futRef,
            category: prefix,
            multiplier: mult,
            target_code: null,
        });
        map.set(`${prefix}R1`, {
            code: `${prefix}R1`,
            name: `${name}近月`,
            exchange: 'TAIFEX',
            security_type: 'FUT',
            reference: futRef,
            category: prefix,
            multiplier: mult,
            target_code: actual,
        });
    }
    return map;
}

export function buildOptionChain(now = new Date()): {
    contracts: OptContract[];
    instruments: SeedInstrument[];
} {
    const contracts: OptContract[] = [];
    const instruments: SeedInstrument[] = [];
    const atm = Math.round(INDEX_REFERENCE / 100) * 100;
    for (const fm of frontMonths(now)) {
        for (let strike = atm - 1000; strike <= atm + 1000; strike += 100) {
            for (const right of ['C', 'P'] as const) {
                const letter = monthLetter(fm.month, right === 'P');
                const code = `TXO${strike}${letter}${fm.year % 10}`;
                const dd = fm.deliveryDate;
                contracts.push({
                    code,
                    exchange: 'TAIFEX',
                    security_type: 'OPT',
                    category: 'TXO',
                    delivery_month: fm.deliveryMonth,
                    delivery_date: `${dd.getFullYear()}/${String(dd.getMonth() + 1).padStart(2, '0')}/${String(dd.getDate()).padStart(2, '0')}`,
                    strike_price: strike,
                    option_right: right,
                    reference: 0, // filled by the engine from option pricing
                });
                instruments.push({
                    code,
                    name: `臺指選${fm.deliveryMonth}${right === 'C' ? '買' : '賣'}${strike}`,
                    exchange: 'TAIFEX',
                    security_type: 'OPT',
                    reference: 0,
                    category: 'TXO',
                    multiplier: 50,
                    target_code: null,
                });
            }
        }
    }
    return { contracts, instruments };
}

// ---- tick-size helpers ----

export function stockTick(price: number): number {
    if (price < 10) return 0.01;
    if (price < 50) return 0.05;
    if (price < 100) return 0.1;
    if (price < 500) return 0.5;
    if (price < 1000) return 1;
    return 5;
}

export function optionTick(price: number): number {
    if (price < 10) return 0.1;
    if (price < 50) return 0.5;
    if (price < 500) return 1;
    if (price < 1000) return 5;
    return 10;
}

export function tickSizeFor(inst: SeedInstrument, price: number): number {
    if (inst.security_type === 'OPT') return optionTick(price);
    if (inst.security_type === 'FUT' || inst.security_type === 'IND') return 1;
    return stockTick(price);
}

export function roundToTick(inst: SeedInstrument, price: number): number {
    const tick = tickSizeFor(inst, price);
    return Math.round(price / tick) * tick;
}

/** mock option premium from underlying price (intrinsic + crude time value) */
export function optionPremium(
    strike: number,
    right: string,
    underlying: number,
): number {
    const intrinsic =
        right === 'C'
            ? Math.max(0, underlying - strike)
            : Math.max(0, strike - underlying);
    const timeValue = Math.max(2, 260 * Math.exp(-Math.abs(underlying - strike) / 700));
    return intrinsic + timeValue;
}
