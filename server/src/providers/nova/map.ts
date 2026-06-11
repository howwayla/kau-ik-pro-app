// server/src/providers/nova/map.ts — DTO ↔ taishin-sdk mapping.
//
// Field shapes are transcribed from taishin-sdk 1.0.2 core.d.ts (the
// napi-generated typings) and the official Nova docs
// (https://ml-fugle-api.tssco.com.tw/FugleSDK/docs/trading/library/nodejs/).
// The SDK ships as a .tgz, so types are declared structurally here to keep
// `tsc` green when the package is not installed.
//
// Verified facts (docs + .d.ts):
//   - enums are plain strings: BSAction 'Buy'|'Sell', TimeInForce
//     'ROD'|'FOK'|'IOC', PriceType 'Limit'|'Market'|…, MarketType
//     'Common'|'Fixing'|'Odd'|'IntradayOdd'|'Emg', OrderType 'Stock'|…
//   - placeOrder quantity is in 股 (docs example: 2000 = 2 張)
//   - OrderRecord orgQty/filledQty/celQty are in 股 (docs: 300000)
//   - modifyVolume third arg = 刪減的股數, 0 = 刪單 (docs: ModifyQuantity)
//   - Ack.act: '0' 新單, 'M' 改量, 'C' 刪單, 'R' 改價 (docs: EnumMatrix)
//   - errCode '000000' means OK (docs: GetOrderResults example)

import type { OrderStatusName, StockOrderReq } from '../../types/dto.ts';

// ---- structural types for the parts of taishin-sdk we touch ----

export interface NovaAccount {
    branchName?: string;
    account: string;
    accountType?: string;
    name?: string;
}

export interface NovaOrder {
    marketType: string;
    buySell: string;
    symbol: string;
    priceType: string;
    price?: string;
    quantity: number;
    timeInForce: string;
    orderType: string;
}

export interface NovaPlaceOrderResponse {
    orderDate: string;
    orderTime: string;
    workDate: string;
    isPreOrder: boolean;
    orderNo: string;
}

export interface NovaOrderRecord {
    workDate?: string;
    orderDate?: string;
    orderTime?: string;
    orderNo?: string;
    symbol?: string;
    buySell?: string;
    marketType: string;
    priceType: string;
    timeInForce?: string;
    orderType?: string;
    orderPrice: number;
    orgQty: number;
    filledQty: number;
    celQty: number;
    canCancel: boolean;
    errCode?: string;
    errMsg?: string;
    seqNo?: string;
    isPreOrder?: boolean;
    avgPrice?: number;
}

export interface NovaAck {
    orderDateTime: string;
    priceType: string;
    orderPrice: number;
    orgQty: number;
    celQty: number;
    canCancel: boolean;
    errCode?: string;
    errMsg: string;
    /** '0' 新單 / 'M' 改量 / 'C' 刪單 / 'R' 改價 */
    act: string;
    beforeQty: number;
    afterQty: number;
    account: string;
    orderNo: string;
    symbol: string;
    marketType: string;
    buySell: string;
    filledQty: number;
    orderSeqNo: string;
}

export interface NovaMat {
    filledTime: string;
    filledPrice: number;
    account: string;
    orderNo: string;
    symbol: string;
    marketType: string;
    buySell: string;
    filledQty: number;
    orderSeqNo: string;
}

export interface NovaPositionSummary {
    symbol?: string;
    symbolName?: string;
    buySell?: string;
    prevDayQuantity?: string;
    currentQuantity?: string;
    averagePrice?: string;
    currentPrice?: string;
    marketValue?: string;
    /** 型別有宣告但實際回傳常缺漏 — 實測以 totalProfit 為準 */
    unrealizedProfit?: string;
    /** 總損益 = positionDetails[].unrealizedProfitLoss 加總（實測驗證） */
    totalProfit?: string;
    positionDetails?: { unrealizedProfitLoss?: string }[];
}

export interface NovaSdk {
    stock: {
        getOrderResults(
            account: NovaAccount,
            queryType?: number | null,
            symbol?: string | null,
        ): NovaOrderRecord[];
        placeOrder(
            account: NovaAccount,
            order: NovaOrder,
        ): NovaPlaceOrderResponse;
        modifyVolume(
            account: NovaAccount,
            orderResult: NovaOrderRecord,
            celQty: number,
        ): { orderDate: string; orderTime: string };
        modifyPrice(
            account: NovaAccount,
            orderResult: NovaOrderRecord,
            newPrice: string,
            newPriceType: string,
        ): { orderDate: string; orderTime: string };
    };
    accounting: {
        inventories(account: NovaAccount): {
            positionSummaries?: NovaPositionSummary[];
        };
        realizedProfitAndLoses(
            account: NovaAccount,
            from: string,
            to: string,
            symbol?: string | null,
        ): {
            profitLossSummary?: { tDate?: string; profitLoss?: string }[];
        };
        bankBalance(account: NovaAccount): {
            availableBalance: number;
            reservedAmount: number;
        }[];
    };
    login(
        personalId: string,
        pass: string,
        certPath: string,
        certPass?: string | null,
    ): NovaAccount[];
    registerApiAuth(account: NovaAccount): boolean;
    /** 取得行情授權並建立 @fugle/marketdata clients（mode 預設 Normal） */
    initRealtime(account: NovaAccount, mode?: string): void;
    marketdata?: {
        webSocketClient: unknown;
        restClient: unknown;
    };
    connectWebsocket(): void;
    setOnOrder(cb: (err: null | Error, event: NovaAck) => void): void;
    setOnFilled(cb: (err: null | Error, event: NovaMat) => void): void;
    setOnError(cb: (err: null | Error, event: string) => void): void;
    setOnDisconnected(cb: (err: null | Error, event: string) => void): void;
}

// ---- unit helpers ----

/** strip thousands separators from the SDK's string numbers */
export function num(v: string | number | undefined | null): number {
    if (v === undefined || v === null) return 0;
    if (typeof v === 'number') return v;
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
}

/** the app counts 張 except for odd-lot orders, which count 股 */
export function isShareLot(marketType: string): boolean {
    return marketType === 'IntradayOdd' || marketType === 'Odd';
}

export function toShares(appQty: number, marketType: string): number {
    return isShareLot(marketType) ? appQty : appQty * 1000;
}

export function toAppQty(shares: number, marketType: string): number {
    return isShareLot(marketType) ? shares : shares / 1000;
}

// ---- mappings ----

export function mapStockOrder(symbol: string, o: StockOrderReq): NovaOrder {
    if (o.order_lot === 'BlockTrade') {
        throw new Error('Nova 不支援鉅額交易（BlockTrade）');
    }
    const marketType =
        o.order_lot === 'IntradayOdd'
            ? 'IntradayOdd'
            : o.order_lot === 'Odd'
              ? 'Odd'
              : o.order_lot === 'Fixing'
                ? 'Fixing'
                : 'Common';
    return {
        marketType,
        buySell: o.action,
        symbol,
        priceType: o.price_type === 'MKT' ? 'Market' : 'Limit',
        ...(o.price_type === 'MKT' ? {} : { price: String(o.price) }),
        quantity: toShares(o.quantity, marketType),
        timeInForce: o.order_type,
        orderType: o.daytrade_short ? 'DayTradeShort' : 'Stock',
    };
}

export function isErrCode(errCode: string | undefined | null): boolean {
    return !!errCode && !/^0+$/.test(errCode);
}

export function deriveStatus(row: NovaOrderRecord): OrderStatusName {
    if (isErrCode(row.errCode)) return 'Failed';
    if (row.celQty > 0 && row.celQty >= row.orgQty) return 'Cancelled';
    const live = row.orgQty - row.celQty;
    if (row.filledQty > 0 && row.filledQty >= live) return 'Filled';
    if (row.filledQty > 0) return 'PartFilled';
    if (row.isPreOrder) return 'PreSubmitted';
    return 'Submitted';
}

/** Ack.act → the op_type vocabulary the frontend was built against */
export function mapAckOpType(act: string): string {
    switch (act) {
        case 'C':
            return 'Cancel';
        case 'M':
            return 'UpdateQty';
        case 'R':
            return 'UpdatePrice';
        default:
            return 'New';
    }
}
