// server/src/providers/esun/map.ts — DTO ↔ @esun/trade mapping.
//
// Shapes transcribed from @esun/trade 2.0.0 lib typings (the SDK is the
// fugle-trade lineage: async Promise API, config-driven login, Streamer
// order reports). Declared structurally so `tsc` stays green without the
// .tgz installed.
//
// Verified facts (lib/*.d.ts + enums):
//   - new EsunTrade({configPath?, config?}) — config overlay wins; with
//     password+certPass both present login() skips the keytar prompt
//   - enums: Side B/S, ApCode 1=Common 2=AfterMarket 3=Odd 4=Emg
//     5=IntradayOdd, PriceFlag 0=Limit 1=Flat 2=LimitDown 3=LimitUp
//     4=Market, BsFlag R/I/F, TradeType 0=Cash 3=Margin 4=Short
//     A=DayTradingSell
//   - quantity is 張 for Common (README: 2884 quantity 1), 股 for odd
//     lots; PlacedOrderPayload carries both orgQty and orgQtyShare
//   - streamer events: 'order' (kind=ACK) / 'trade' (kind=MAT)
//   - logout() 會刪除 keyring 憑證 — 永遠不要呼叫（dispose 只斷線）

import type { OrderStatusName, StockOrderReq } from '../../types/dto.ts';

// ---- structural types for the parts of @esun/trade we touch ----

export interface EsunConfig {
    apiUrl: string;
    apiKey: string;
    apiSecret: string;
    certPath: string;
    certPass: string;
    aid: string;
    password: string;
}

export interface EsunOrderPayload {
    buySell: string;
    price?: number;
    stockNo: string;
    quantity: number;
    apCode: string;
    priceFlag: string;
    bsFlag: string;
    trade: string;
}

export interface EsunPlacedOrderPayload {
    apCode?: string;
    avgPrice?: number;
    bsFlag?: string;
    buySell?: string;
    celable?: string;
    celQty?: number;
    celQtyShare?: number;
    errCode?: string;
    errMsg?: string;
    matQty?: number;
    matQtyShare?: number;
    odPrice?: number;
    ordDate?: string;
    ordNo?: string;
    preOrdNo?: string;
    ordStatus?: string;
    orgQty?: number;
    orgQtyShare?: number;
    priceFlag?: string;
    stockNo?: string;
    trade?: string;
    workDate?: string;
}

export interface EsunPlacedOrder {
    payload: EsunPlacedOrderPayload;
}

export interface EsunPlaceOrderResponse {
    retCode: string;
    retMsg: string;
    workDate: string;
    ordNo: string;
    ordDate: string;
    ordTime: string;
}

export interface EsunInventory {
    stkNo?: string;
    stkNa?: string;
    costQty?: string;
    qtyL?: string;
    priceAvg?: string;
    priceNow?: string;
    priceEvn?: string;
    makeASum?: string;
    valueNow?: string;
    trade?: string;
}

export interface EsunStreamer {
    connect(): unknown;
    disconnect(): unknown;
    on(event: string, cb: (msg: Record<string, unknown>) => void): unknown;
}

export interface EsunSdk {
    login(): Promise<void>;
    streamer: EsunStreamer;
    placeOrder(order: unknown): Promise<EsunPlaceOrderResponse>;
    cancelOrder(placedOrder: EsunPlacedOrder): Promise<unknown>;
    replacePrice(
        placedOrder: EsunPlacedOrder,
        price: number,
    ): Promise<unknown>;
    replaceQuantity(
        placedOrder: EsunPlacedOrder,
        quantity: number,
    ): Promise<unknown>;
    getOrders(): Promise<EsunPlacedOrder[]>;
    getInventories(): Promise<EsunInventory[]>;
    getBalance(): Promise<{ availableBalance: number }>;
    getTransactions(options: {
        startDate?: string;
        endDate?: string;
        duration?: string;
    }): Promise<Record<string, unknown>[]>;
}

export interface EsunMarketdataClient {
    login(): Promise<void>;
    restClient: unknown;
    websocketClient: unknown;
}

// ---- unit helpers (app counts 張 except odd lots which count 股) ----

/** ApCode 3 (盤後零股) / 5 (盤中零股) trade in 股 */
export function isShareLot(apCode: string | undefined): boolean {
    return apCode === '3' || apCode === '5';
}

export function num(v: string | number | undefined | null): number {
    if (v === undefined || v === null) return 0;
    if (typeof v === 'number') return v;
    const n = Number(String(v).replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
}

// ---- mappings ----

const AP_CODE: Record<string, string> = {
    Common: '1',
    Fixing: '2', // AfterMarket
    Odd: '3',
    IntradayOdd: '5',
};

export function mapStockOrder(
    symbol: string,
    o: StockOrderReq,
): EsunOrderPayload {
    if (o.order_lot === 'BlockTrade') {
        throw new Error('玉山 API 不支援鉅額交易（BlockTrade）');
    }
    const apCode = AP_CODE[o.order_lot ?? 'Common'] ?? '1';
    return {
        buySell: o.action === 'Sell' ? 'S' : 'B',
        ...(o.price_type === 'MKT' ? {} : { price: o.price }),
        stockNo: symbol,
        quantity: o.quantity, // 張 for Common/Fixing, 股 for odd lots — matches app
        apCode,
        priceFlag: o.price_type === 'MKT' ? '4' : '0',
        bsFlag:
            o.order_type === 'IOC' ? 'I' : o.order_type === 'FOK' ? 'F' : 'R',
        trade: o.daytrade_short ? 'A' : '0',
    };
}

export function isErrCode(errCode: string | undefined | null): boolean {
    return !!errCode && !/^0+$/.test(errCode);
}

export function deriveStatus(p: EsunPlacedOrderPayload): OrderStatusName {
    if (isErrCode(p.errCode)) return 'Failed';
    const org = num(p.orgQty);
    const cel = num(p.celQty);
    const mat = num(p.matQty);
    if (cel > 0 && cel >= org) return 'Cancelled';
    if (mat > 0 && mat >= org - cel) return 'Filled';
    if (mat > 0) return 'PartFilled';
    if (p.preOrdNo) return 'PreSubmitted';
    return 'Submitted';
}
