// src/lib/types/market.ts — market data shapes (REST + SSE)

// REST /api/v1/data/snapshots — prices are JSON numbers
export interface Snapshot {
    code: string;
    exchange: string;
    datetime: string;
    open: number;
    high: number;
    low: number;
    close: number;
    average_price: number;
    buy_price: number;
    buy_volume: number;
    sell_price: number;
    sell_volume: number;
    volume: number;
    total_volume: number;
    amount: number;
    total_amount: number;
    change_price: number;
    change_rate: number;
    change_type: string;
    tick_type: string;
    volume_ratio: number;
    yesterday_volume: number;
}

// REST /api/v1/data/kbars — column arrays
export interface KBars {
    datetime: string[];
    Open: number[];
    High: number[];
    Low: number[];
    Close: number[];
    Volume: number[];
    Amount: number[];
}

export interface Candle {
    time: number; // unix seconds
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

// REST /api/v1/data/scanner
export interface ScannerItem {
    code: string;
    name: string;
    date: string;
    close: number;
    open: number;
    high: number;
    low: number;
    change_price: number;
    change_type: number;
    average_price: number;
    price_range: number;
    rank_value: number;
    total_volume: number;
    total_amount: number;
    volume_ratio: number;
    yesterday_volume: number;
    tick_type: number;
    buy_price: number;
    sell_price: number;
}

export type ScannerType =
    | 'ChangePercentRank'
    | 'ChangePriceRank'
    | 'DayRangeRank'
    | 'VolumeRank'
    | 'AmountRank'
    | 'TickCountRank';

// SSE tick events (tick_stk / tick_fop) — Decimal fields arrive as strings
export interface SseTick {
    code: string;
    date: string;
    time: string;
    open: string;
    high: string;
    low: string;
    close: string;
    avg_price?: string;
    volume: number;
    total_volume: number;
    amount?: string;
    total_amount?: string;
    tick_type: number; // 1=buy 2=sell 0=unknown
    chg_type?: number;
    price_chg?: string;
    pct_chg?: string;
    bid_side_total_vol?: number;
    ask_side_total_vol?: number;
    underlying_price?: string;
    intraday_odd?: boolean;
    simtrade?: boolean;
}

// SSE bidask events (bidask_stk / bidask_fop)
export interface SseBidAsk {
    code: string;
    date: string;
    time: string;
    bid_price: string[];
    bid_volume: number[];
    ask_price: string[];
    ask_volume: number[];
    diff_bid_vol?: number[];
    diff_ask_vol?: number[];
    intraday_odd?: boolean;
    simtrade?: boolean;
}

export type QuoteTypeName = 'Tick' | 'BidAsk' | 'Quote';

export interface SubscriptionResponse {
    success: boolean;
    message?: string;
    subscription?: unknown;
}
