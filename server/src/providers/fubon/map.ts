// server/src/providers/fubon/map.ts — DTO ↔ fubon-neo mapping.
//
// Written against the official docs (https://www.fbs.com.tw/TradeAPI/);
// the SDK ships as a manually-downloaded .tgz so none of this has run
// against the real library yet. Everything marked TODO(verify) must be
// checked once the SDK is in server/vendor/.
//
// Enum strategy: we map to enum KEY NAMES and resolve the actual values
// from the imported SDK module at runtime (sdk.BSAction[key]), so this
// file stays correct regardless of how the enums are represented.

import type {
    FuturesOrderReq,
    OrderStatusName,
    StockOrderReq,
} from '../../types/dto.ts';

export interface FubonEnums {
    BSAction: Record<string, unknown>;
    MarketType: Record<string, unknown>;
    PriceType: Record<string, unknown>;
    TimeInForce: Record<string, unknown>;
    OrderType: Record<string, unknown>;
    FutOptMarketType: Record<string, unknown>;
    FutOptPriceType: Record<string, unknown>;
    FutOptOrderType: Record<string, unknown>;
}

export function mapStockOrder(
    enums: FubonEnums,
    symbol: string,
    o: StockOrderReq,
): Record<string, unknown> {
    // MarketType: Common | Fixing | IntradayOdd | Odd | Emg | EmgOdd
    const marketKey =
        o.order_lot === 'IntradayOdd'
            ? 'IntradayOdd'
            : o.order_lot === 'Odd'
              ? 'Odd'
              : o.order_lot === 'Fixing'
                ? 'Fixing'
                : 'Common'; // BlockTrade has no Fubon equivalent — TODO(verify)
    return {
        buySell: enums.BSAction[o.action],
        symbol,
        price: o.price_type === 'MKT' ? null : String(o.price), // TODO(verify): market-order price field
        quantity: o.quantity * (marketKey === 'Common' ? 1000 : 1), // stock qty in shares; app uses 張 — TODO(verify)
        marketType: enums.MarketType[marketKey],
        priceType: enums.PriceType[o.price_type === 'MKT' ? 'Market' : 'Limit'],
        timeInForce: enums.TimeInForce[o.order_type],
        orderType:
            enums.OrderType[o.daytrade_short ? 'DayTrade' : 'Stock'],
        userDef: 'novapro',
    };
}

export function mapFuturesOrder(
    enums: FubonEnums,
    symbol: string,
    o: FuturesOrderReq,
    isOption: boolean,
): Record<string, unknown> {
    const priceKey =
        o.price_type === 'MKT'
            ? 'Market'
            : o.price_type === 'MKP'
              ? 'RangeMarket'
              : 'Limit';
    const octypeKey =
        o.octype === 'New'
            ? 'New'
            : o.octype === 'Cover'
              ? 'Close'
              : o.octype === 'DayTrade'
                ? 'FdayTrade'
                : 'Auto';
    return {
        buySell: enums.BSAction[o.action],
        symbol,
        price: o.price_type === 'LMT' ? String(o.price) : null, // TODO(verify)
        lot: o.quantity,
        marketType:
            enums.FutOptMarketType[isOption ? 'Option' : 'Future'], // night session unsupported — TODO
        priceType: enums.FutOptPriceType[priceKey],
        timeInForce: enums.TimeInForce[o.order_type],
        orderType: enums.FutOptOrderType[octypeKey],
        userDef: 'novapro',
    };
}

// TODO(verify): Fubon OrderResult.status is numeric; these codes are a
// best guess from the docs' examples and MUST be confirmed with the SDK.
const STATUS_MAP: Record<number, OrderStatusName> = {
    0: 'PendingSubmit',
    4: 'Failed',
    9: 'PendingSubmit',
    10: 'Submitted',
    30: 'Cancelled',
    40: 'PartFilled',
    50: 'Filled',
    90: 'Inactive',
};

export function mapOrderStatus(status: number): OrderStatusName {
    return STATUS_MAP[status] ?? 'Submitted';
}
