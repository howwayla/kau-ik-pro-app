// src/lib/types/tick.ts

export interface Tick {
    code: string;
    time: string;
    close: number;
    volume: number;
    tick_type: number;
}

export interface HistoryTicks {
    datetime: string[];
    close: number[];
    volume: number[];
    bid_price: number[];
    bid_volume: number[];
    ask_price: number[];
    ask_volume: number[];
    tick_type: number[];
}

/** 分價量表一列（官方 intraday/volumes；期貨無內外盤欄位 → at_* 為 0） */
export interface VolumeLevel {
    price: number;
    volume: number;
    at_bid: number;
    at_ask: number;
}
