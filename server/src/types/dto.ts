// server/src/types/dto.ts — wire types shared with the frontend.
// These mirror src/lib/types/*.ts in the web app; field names and value
// formats (string decimals in SSE, column arrays in KBars, …) must stay
// in sync with what the React components parse.

export type Exchange = 'TSE' | 'OTC' | 'OES' | 'TAIFEX' | null;
export type SecurityType = 'IND' | 'STK' | 'FUT' | 'OPT' | null;
export type Currency = 'TWD' | 'USD' | 'CNY';
export type DayTrade = 'Yes' | 'OnlyBuy' | 'No' | '';

export interface ContractBase {
    exchange: Exchange;
    code: string;
    security_type: SecurityType;
    target_code: string | null;
}

export interface Contract extends ContractBase {
    name: string;
    currency: Currency;
}

export interface ContractInfo extends Contract {
    limit_up: number;
    limit_down: number;
    reference: number;
    /** 昨收 — 除權息日 ≠ reference（今日參考價）；當日損益變化要用這個 */
    previous_close: number;
    day_trade: DayTrade;
    update_date: string;
    category: string;
    margin_trading_balance: number;
    short_selling_balance: number;
}

export interface OptContract {
    code: string;
    exchange: string;
    security_type: string;
    category: string;
    delivery_month: string; // YYYYMM
    delivery_date: string;
    strike_price: number;
    option_right: string; // 'C…' call / 'P…' put
    reference: number;
}

export interface Health {
    status: string;
    version: string;
    timestamp: string;
    token_expires_in_seconds: number;
    token_stale: boolean;
    contract_count: number;
    next_maintenance: string;
}

export interface ServerInfo {
    name: string;
    version: string;
    description: string;
    protocols: string[];
    simulation: boolean;
    capabilities: { futures_trading: boolean };
}

// ---- market data ----

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

export interface KBars {
    datetime: string[]; // "YYYY-MM-DD HH:mm:ss" Taiwan wall clock
    Open: number[];
    High: number[];
    Low: number[];
    Close: number[];
    Volume: number[];
    Amount: number[];
}

export interface HistoryTicks {
    datetime: string[]; // "YYYY-MM-DD HH:mm:ss.ffffff"
    close: number[];
    volume: number[];
    bid_price: number[];
    bid_volume: number[];
    ask_price: number[];
    ask_volume: number[];
    tick_type: number[];
}

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

export interface CreditEnquire {
    stock_id: string;
    system: string;
    update_time: string;
    margin_unit: number;
    short_unit: number;
    margin_loan_ratio: number;
    short_margin_ratio: number;
}

export interface ShortSource {
    code: string;
    short_stock_source: number;
    datetime: string;
}

// ---- SSE payloads (decimal fields are strings) ----

export interface SseTick {
    code: string;
    date: string; // YYYY-MM-DD
    time: string; // HH:mm:ss.ffffff
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
}

// ---- orders ----

export type Action = 'Buy' | 'Sell';
export type OrderType = 'ROD' | 'IOC' | 'FOK';
export type StockPriceType = 'LMT' | 'MKT';
export type FuturesPriceType = 'LMT' | 'MKT' | 'MKP';
export type FuturesOCType = 'Auto' | 'New' | 'Cover' | 'DayTrade';
export type StockOrderLot =
    | 'Common'
    | 'BlockTrade'
    | 'Fixing'
    | 'Odd'
    | 'IntradayOdd';
export type OrderStatusName =
    | 'Cancelled'
    | 'Filled'
    | 'PartFilled'
    | 'Inactive'
    | 'Failed'
    | 'PendingSubmit'
    | 'PreSubmitted'
    | 'Submitted';

export interface StockOrderReq {
    action: Action;
    price: number;
    quantity: number;
    price_type: StockPriceType;
    order_type: OrderType;
    order_lot?: StockOrderLot;
    daytrade_short?: boolean;
}

export interface FuturesOrderReq {
    action: Action;
    price: number;
    quantity: number;
    price_type: FuturesPriceType;
    order_type: OrderType;
    octype?: FuturesOCType;
}

export interface Deal {
    seq: string;
    price: number;
    quantity: number;
    ts: number;
}

export interface OrderResult {
    id: string;
    seqno: string;
    ordno: string;
    action: Action;
    price: number;
    quantity: number;
    order_type?: OrderType;
    price_type?: string;
    order_lot?: string;
    octype?: string;
    custom_field?: string;
    account?: { broker_id: string; account_id: string; account_type: string };
}

export interface OrderStatusInfo {
    id: string;
    status: OrderStatusName;
    status_code: string;
    order_ts?: number;
    order_quantity: number;
    deal_quantity: number;
    cancel_quantity: number;
    modified_price: number;
    msg: string;
    deals: Deal[];
}

export interface Trade {
    contract: ContractBase & { name?: string };
    order: OrderResult;
    status: OrderStatusInfo;
}

// order_event SSE payload: standard events are nested; deal events carry
// flat code/price/quantity fields (bracket.ts relies on both forms)
export interface OrderEventData {
    operation: { op_type: string; op_code: string; op_msg: string };
    order?: {
        id?: string;
        seqno?: string;
        ordno?: string;
        action?: Action;
        price?: number;
        quantity?: number;
    };
    contract?: { code?: string };
    status?: Record<string, unknown>;
    code?: string;
    price?: number;
    quantity?: number;
    action?: Action;
}

// ---- portfolio ----

export type AccountTypeName = 'S' | 'F';

export interface Account {
    account_type: string;
    person_id: string;
    broker_id: string;
    account_id: string;
    signed: boolean;
    username: string;
}

export interface StockPosition {
    id: number;
    code: string;
    direction: Action;
    quantity: number;
    price: number;
    last_price: number;
    pnl: number;
    yd_quantity: number;
    cond?: string;
}

export interface FuturePosition {
    id: number;
    code: string;
    direction: Action;
    quantity: number;
    price: number;
    last_price: number;
    pnl: number;
}

export type Position = StockPosition | FuturePosition;

export interface AccountBalance {
    acc_balance: number;
    date: string;
    errmsg: string;
}

export interface Margin {
    yesterday_balance: number;
    today_balance: number;
    deposit_withdrawal: number;
    fee: number;
    tax: number;
    initial_margin: number;
    maintenance_margin: number;
    margin_call: number;
    risk_indicator: number;
    royalty_revenue_expenditure: number;
    equity: number;
    equity_amount: number;
    option_openbuy_market_value: number;
    option_opensell_market_value: number;
    option_open_position: number;
    option_settle_profitloss: number;
    future_open_position: number;
    today_future_open_position: number;
    future_settle_profitloss: number;
    available_margin: number;
    plus_margin: number;
    plus_margin_indicator: number;
    security_collateral_amount: number;
    order_margin_premium: number;
    collateral_amount: number;
}

export interface PnlRow {
    date: string;
    pnl: number;
}

export interface ServerWatchlist {
    id: string;
    name: string;
    contracts: { security_type: SecurityType; exchange: string; code: string }[];
}
