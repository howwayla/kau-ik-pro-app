// server/src/providers/fubon/map.ts — DTO ↔ fubon-neo mapping.
//
// Verified against the fubon-neo SDK typings (trade.d.ts, shipped in
// the official .tgz) and the official docs
// (https://www.fbs.com.tw/TradeAPI/docs/trading/library/nodejs/).
// Types are declared structurally so `tsc` stays green when the .tgz is
// not installed.
//
// Verified facts:
//   - enums are plain strings: BSAction 'Buy'|'Sell', MarketType
//     'Common'|'Fixing'|'Odd'|'IntradayOdd'|'Emg'|'EmgOdd', PriceType
//     'Limit'|'Market'|…, TimeInForce 'ROD'|'FOK'|'IOC', OrderType
//     'Stock'|'Margin'|'Short'|'SBL'|'DayTrade'
//   - quantity is in 股 for every marketType (docs EnumMatrix: Common
//     1000–499000, odd lots 1–999); the app counts 張 except odd lots
//   - Account.accountType is 'stock' | 'futopt' (runtime verified)
//   - OrderResult.status (docs EnumMatrix): 0 預約單, 4 系統將委託送往
//     後台, 8 後台傳送中, 9 連線逾時, 10 委託成功, 30 未成交刪單成功,
//     40 部分成交剩餘取消, 50 完全成交, 90 失敗
//   - modify flows go through makeModifyPriceObj / makeModifyQuantityObj
//     (stock) and makeModifyPriceObj / makeModifyLotObj (futopt);
//     ModifyQuantity.newQuantity is the new ABSOLUTE effective quantity
//   - all callbacks are (err, event) napi pairs

import type {
    FuturesOrderReq,
    OrderStatusName,
    StockOrderReq,
} from '../../types/dto.ts';

// ---- structural types for the parts of fubon-neo we touch ----

export interface FubonResponse<T> {
    isSuccess: boolean;
    data?: T;
    message?: string;
}

export interface FubonAccount {
    name: string;
    branchNo: string;
    account: string;
    /** 'stock' | 'futopt' */
    accountType: string;
}

export interface FubonOrderObject {
    buySell: string;
    symbol: string;
    quantity: number;
    marketType: string;
    priceType: string;
    timeInForce: string;
    orderType: string;
    price?: string;
    userDef?: string;
}

export interface FubonFutOptOrderObject {
    buySell: string;
    symbol: string;
    price?: string;
    lot: number;
    marketType: string;
    priceType: string;
    timeInForce: string;
    orderType: string;
    userDef?: string;
}

export interface FubonOrderResult {
    functionType?: number;
    date: string;
    seqNo: string;
    branchNo: string;
    account: string;
    orderNo?: string;
    marketType: string;
    stockNo?: string;
    buySell?: string;
    priceType?: string;
    price?: number;
    quantity?: number;
    timeInForce?: string;
    orderType?: string;
    isPreOrder: boolean;
    status?: number;
    afterPriceType?: string;
    afterPrice?: number;
    afterQty?: number;
    filledQty?: number;
    filledMoney?: number;
    beforeQty?: number;
    beforePrice?: number;
    lastTime: string;
    errorMessage?: string;
}

export interface FubonFutOptOrderResult {
    functionType?: number;
    date: string;
    seqNo: string;
    orderNo?: string;
    marketType: string;
    symbol?: string;
    buySell?: string;
    priceType?: string;
    price?: number;
    afterPrice?: number;
    lot?: number;
    afterLot?: number;
    timeInForce?: string;
    orderType?: string;
    status?: number;
    isPreOrder: boolean;
    filledLot?: number;
    beforeLot?: number;
    beforePrice?: number;
    lastTime: string;
    errorMessage?: string;
}

export interface FubonFilledData {
    date: string;
    branchNo: string;
    account: string;
    orderNo: string;
    stockNo: string;
    buySell: string;
    seqNo?: string;
    filledNo: string;
    filledAvgPrice: number;
    filledQty: number;
    filledPrice: number;
    filledTime: string;
}

export interface FubonFutOptFilledData {
    date: string;
    orderNo: string;
    symbol: string;
    buySell: string;
    seqNo?: string;
    filledNo: string;
    filledAvgPrice: number;
    filledLot: number;
    filledPrice: number;
    filledTime: string;
}

export interface FubonUnrealized {
    date: string;
    branchNo: string;
    account: string;
    stockNo: string;
    buySell: string;
    orderType: string;
    costPrice: number;
    tradableQty: number;
    todayQty: number;
    unrealizedProfit: number;
    unrealizedLoss: number;
}

export interface FubonRealized {
    date: string;
    stockNo: string;
    buySell: string;
    filledQty: number;
    filledPrice: number;
    orderType: string;
    realizedProfit: number;
    realizedLoss: number;
}

export interface FubonBankRemain {
    branchNo: string;
    account: string;
    currency: string;
    balance: number;
    availableBalance: number;
}

export interface FubonEquity {
    date: string;
    currency: string;
    yesterdayBalance: number;
    todayBalance: number;
    initialMargin: number;
    maintenanceMargin: number;
    todayEquity: number;
    todayDeposit: number;
    todayWithdrawal: number;
    todayTradingFee: number;
    todayTradingTax: number;
    excessMargin: number;
    availableMargin: number;
    optPnl: number;
    optValue: number;
    optLongValue: number;
    optShortValue: number;
    futRealizedPnl: number;
    futUnrealizedPnl: number;
}

export interface FubonFutPosition {
    date: string;
    orderNo: string;
    symbol: string;
    buySell: string;
    price?: number;
    origLots: number;
    tradableLot: number;
    profitOrLoss: number;
    marketPrice: string;
}

/** opaque handles produced by makeModify*Obj */
export type FubonModifyPriceObj = Record<string, unknown>;
export type FubonModifyQuantityObj = Record<string, unknown>;
export type FubonModifyLotObj = Record<string, unknown>;

export interface FubonSdk {
    login(
        personalId: string,
        pass: string,
        certPath: string,
        certPass?: string | null,
    ): FubonResponse<FubonAccount[]>;
    /** v2.2.7+ API key login — still requires the certificate */
    apikeyLogin(
        personalId: string,
        apiKey: string,
        certPath: string,
        certPass?: string | null,
    ): FubonResponse<FubonAccount[]>;
    logout(): boolean;
    /** 取得行情授權並建立 @fugle/marketdata clients（mode 預設 Speed！） */
    initRealtime(mode?: string): void;
    marketdata?: {
        webSocketClient: unknown;
        restClient: unknown;
    };
    stock: {
        placeOrder(
            account: FubonAccount,
            order: FubonOrderObject,
            unblock?: boolean | null,
        ): FubonResponse<FubonOrderResult>;
        getOrderResults(
            account: FubonAccount,
        ): FubonResponse<FubonOrderResult[]>;
        cancelOrder(
            account: FubonAccount,
            orderRes: FubonOrderResult,
            unblock?: boolean | null,
        ): FubonResponse<FubonOrderResult>;
        makeModifyPriceObj(
            order: FubonOrderResult,
            price?: string | null,
            priceType?: string | null,
        ): FubonModifyPriceObj;
        makeModifyQuantityObj(
            order: FubonOrderResult,
            quantity: number,
        ): FubonModifyQuantityObj;
        modifyPrice(
            account: FubonAccount,
            orderRes: FubonModifyPriceObj,
            unblock?: boolean | null,
        ): FubonResponse<FubonOrderResult>;
        modifyQuantity(
            account: FubonAccount,
            orderRes: FubonModifyQuantityObj,
            unblock?: boolean | null,
        ): FubonResponse<FubonOrderResult>;
    };
    accounting: {
        inventories(account: FubonAccount): FubonResponse<unknown[]>;
        unrealizedGainsAndLoses(
            account: FubonAccount,
        ): FubonResponse<FubonUnrealized[]>;
        realizedGainsAndLoses(
            account: FubonAccount,
        ): FubonResponse<FubonRealized[]>;
        bankRemain(account: FubonAccount): FubonResponse<FubonBankRemain>;
    };
    futopt: {
        placeOrder(
            account: FubonAccount,
            order: FubonFutOptOrderObject,
            unblock?: boolean | null,
        ): FubonResponse<FubonFutOptOrderResult>;
        getOrderResults(
            account: FubonAccount,
            marketType?: string | null,
        ): FubonResponse<FubonFutOptOrderResult[]>;
        cancelOrder(
            account: FubonAccount,
            orderRes: FubonFutOptOrderResult,
            unblock?: boolean | null,
        ): FubonResponse<FubonFutOptOrderResult>;
        makeModifyPriceObj(
            order: FubonFutOptOrderResult,
            price?: string | null,
            priceType?: string | null,
        ): FubonModifyPriceObj;
        makeModifyLotObj(
            order: FubonFutOptOrderResult,
            lot: number,
        ): FubonModifyLotObj;
        modifyPrice(
            account: FubonAccount,
            orderRes: FubonModifyPriceObj,
            unblock?: boolean | null,
        ): FubonResponse<FubonFutOptOrderResult>;
        modifyLot(
            account: FubonAccount,
            orderRes: FubonModifyLotObj,
            unblock?: boolean | null,
        ): FubonResponse<FubonFutOptOrderResult>;
    };
    futoptAccounting: {
        queryMarginEquity(account: FubonAccount): FubonResponse<FubonEquity[]>;
        querySinglePosition(
            account: FubonAccount,
        ): FubonResponse<FubonFutPosition[]>;
    };
    setOnOrder(
        cb: (err: null | Error, event: FubonOrderResult) => void,
    ): void;
    setOnOrderChanged(
        cb: (err: null | Error, event: FubonOrderResult) => void,
    ): void;
    setOnFilled(
        cb: (err: null | Error, event: FubonFilledData) => void,
    ): void;
    setOnFutoptOrder(
        cb: (err: null | Error, event: FubonFutOptOrderResult) => void,
    ): void;
    setOnFutoptOrderChanged(
        cb: (err: null | Error, event: FubonFutOptOrderResult) => void,
    ): void;
    setOnFutoptFilled(
        cb: (err: null | Error, event: FubonFutOptFilledData) => void,
    ): void;
    setOnEvent(cb: (code: string, message: string) => void): void;
}

// ---- unit helpers (the app counts 張/口, the SDK counts 股 for stocks) ----

export function isShareLot(marketType: string): boolean {
    return (
        marketType === 'IntradayOdd' ||
        marketType === 'Odd' ||
        marketType === 'EmgOdd'
    );
}

export function toShares(appQty: number, marketType: string): number {
    return isShareLot(marketType) ? appQty : appQty * 1000;
}

export function toAppQty(shares: number, marketType: string): number {
    return isShareLot(marketType) ? shares : shares / 1000;
}

// ---- mappings ----

export function mapStockOrder(
    symbol: string,
    o: StockOrderReq,
): FubonOrderObject {
    if (o.order_lot === 'BlockTrade') {
        throw new Error('fubon-neo 不支援鉅額交易（BlockTrade）');
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
        buySell: o.action,
        symbol,
        ...(o.price_type === 'MKT' ? {} : { price: String(o.price) }),
        quantity: toShares(o.quantity, marketType),
        marketType,
        priceType: o.price_type === 'MKT' ? 'Market' : 'Limit',
        timeInForce: o.order_type,
        orderType: o.daytrade_short ? 'DayTrade' : 'Stock',
        userDef: 'novapro',
    };
}

export function mapFuturesOrder(
    symbol: string,
    o: FuturesOrderReq,
    isOption: boolean,
): FubonFutOptOrderObject {
    const priceType =
        o.price_type === 'MKT'
            ? 'Market'
            : o.price_type === 'MKP'
              ? 'RangeMarket'
              : 'Limit';
    const orderType =
        o.octype === 'New'
            ? 'New'
            : o.octype === 'Cover'
              ? 'Close'
              : o.octype === 'DayTrade'
                ? 'FdayTrade'
                : 'Auto';
    return {
        buySell: o.action,
        symbol,
        ...(o.price_type === 'LMT' ? { price: String(o.price) } : {}),
        lot: o.quantity,
        marketType: isOption ? 'Option' : 'Future', // 夜盤 = FutureNight/OptionNight,本 app 僅日盤
        priceType,
        timeInForce: o.order_type,
        orderType,
        userDef: 'novapro',
    };
}

// 官方 STATUS 對照（docs EnumMatrix）: 0 預約單 / 4 系統將委託送往後台 /
// 8 後台傳送中 / 9 連線逾時 / 10 委託成功 / 30 未成交刪單成功 /
// 40 部分成交剩餘取消 / 50 完全成交 / 90 失敗
// (sdk-core 將 status%10==4 正規化為 4)
const STATUS_MAP: Record<number, OrderStatusName> = {
    0: 'PreSubmitted',
    4: 'PendingSubmit',
    8: 'PendingSubmit',
    9: 'PendingSubmit',
    10: 'Submitted',
    30: 'Cancelled',
    40: 'PartFilled',
    50: 'Filled',
    90: 'Failed',
};

export function mapOrderStatus(
    status: number | undefined,
    filledQty = 0,
): OrderStatusName {
    const base = STATUS_MAP[status ?? 10] ?? 'Submitted';
    // 委託中但已有部分成交 → PartFilled
    if (base === 'Submitted' && filledQty > 0) return 'PartFilled';
    return base;
}
