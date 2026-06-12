// server/src/providers/trading.ts — trading provider contract.

import type {
    Account,
    AccountBalance,
    AccountTypeName,
    FuturesOrderReq,
    Margin,
    OrderEventData,
    PnlRow,
    Position,
    StockOrderReq,
    Trade,
} from '../types/dto.ts';
import type { ContractKey, MarketClientSource } from './market-data.ts';
import type { Action } from '../types/dto.ts';

export interface TradingCapabilities {
    futures: boolean;
    /** broker-side condition orders with TP/SL children (L1 protection) */
    condition_orders: boolean;
}

/** entry + protective bracket placed AS a broker-side condition order */
export interface BracketSpec {
    stop?: number;
    take?: number;
    expiry: 'day' | 'gtc';
}

export interface ConditionOrderRow {
    guid: string;
    code: string;
    action: Action;
    price: number | null;
    quantity: number;
    account_type: AccountTypeName;
    /** normalized-ish status text; raw_status preserves the SDK value */
    status: string;
    raw_status: string;
    tpsl: { stop?: number; take?: number };
    created: string;
}

/** thrown by broker condition methods — routes fall back to the server
 *  trigger engine (L2) and surface a warning */
export class ConditionOrderError extends Error {}

export interface TradingProvider {
    init(): Promise<void>;
    capabilities(): TradingCapabilities;
    accounts(): Promise<Account[]>;

    placeStockOrder(key: ContractKey, order: StockOrderReq): Promise<Trade>;
    /** providers with capabilities().futures === false may throw */
    placeFuturesOrder(
        key: ContractKey,
        order: FuturesOrderReq,
    ): Promise<Trade>;
    cancel(tradeId: string): Promise<Trade>;
    updatePrice(tradeId: string, price: number): Promise<Trade>;
    updateQty(tradeId: string, quantity: number): Promise<Trade>;
    trades(accountType: AccountTypeName): Promise<Trade[]>;

    positions(accountType: AccountTypeName): Promise<Position[]>;
    accountBalance(): Promise<AccountBalance>;
    margin(): Promise<Margin>;
    profitLoss(
        beginDate: string,
        endDate: string,
        accountType: AccountTypeName,
    ): Promise<PnlRow[]>;

    onOrderEvent(cb: (ev: OrderEventData) => void): void;

    /** broker-side condition orders (fubon only in v1) */
    placeStockBracketCondition?(
        key: ContractKey,
        order: StockOrderReq,
        bracket: BracketSpec,
    ): Promise<{ guid: string }>;
    placeFuturesBracketCondition?(
        key: ContractKey,
        order: FuturesOrderReq,
        bracket: BracketSpec,
    ): Promise<{ guid: string }>;
    listConditionOrders?(
        accountType: AccountTypeName,
    ): Promise<ConditionOrderRow[]>;
    cancelConditionOrder?(
        guid: string,
        accountType: AccountTypeName,
    ): Promise<void>;

    /** broker SDKs that bundle market data expose it here (after init) */
    marketdataSource?(): MarketClientSource | null;
    /** release sessions / sockets when the provider is swapped out */
    dispose?(): void;
}

export class TradeNotFoundError extends Error {
    constructor(tradeId: string) {
        super(`trade not found: ${tradeId}`);
    }
}

export class FuturesNotSupportedError extends Error {
    constructor() {
        super('此券商不支援期貨/選擇權下單');
    }
}

export function zeroMargin(): Margin {
    return {
        yesterday_balance: 0,
        today_balance: 0,
        deposit_withdrawal: 0,
        fee: 0,
        tax: 0,
        initial_margin: 0,
        maintenance_margin: 0,
        margin_call: 0,
        risk_indicator: 0,
        royalty_revenue_expenditure: 0,
        equity: 0,
        equity_amount: 0,
        option_openbuy_market_value: 0,
        option_opensell_market_value: 0,
        option_open_position: 0,
        option_settle_profitloss: 0,
        future_open_position: 0,
        today_future_open_position: 0,
        future_settle_profitloss: 0,
        available_margin: 0,
        plus_margin: 0,
        plus_margin_indicator: 0,
        security_collateral_amount: 0,
        order_margin_premium: 0,
        collateral_amount: 0,
    };
}
