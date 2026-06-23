// src/lib/backend.ts — REST client for the local kau-ik-pro-server

import { apiDelete, apiGet, apiPost, apiPut } from './api';
import type {
    ContractBase,
    ContractInfo,
    SecurityType,
} from './types/contract';
import type { Health } from './types/health';
import type {
    KBars,
    QuoteTypeName,
    ScannerItem,
    ScannerType,
    Snapshot,
    SubscriptionResponse,
} from './types/market';
import type {
    FuturesOrderReq,
    StockOrderReq,
    Trade,
} from './types/order';
import type {
    Account,
    AccountBalance,
    AccountTypeName,
    FuturePosition,
    Margin,
    StockPosition,
} from './types/portfolio';
import { registerSubscription, unregisterSubscription } from './stream';
import type { HistoryTicks, VolumeLevel } from './types/tick';
import { todayStr } from './utils/date';

export interface ServerInfo {
    name: string;
    version: string;
    description: string;
    protocols: string[];
    simulation: boolean;
    capabilities?: { futures_trading: boolean; condition_orders?: boolean };
}

function contractKey(c: ContractBase) {
    return {
        security_type: c.security_type,
        exchange: c.exchange,
        code: c.code,
    };
}

// ---- market source config ----

/** fubon/nova/esun = the active broker's bundled market-data feed */
export type MarketProviderName = 'mock' | 'fugle' | 'fubon' | 'nova' | 'esun';

export interface MarketConfig {
    provider: MarketProviderName;
    has_key: boolean;
}

export function fetchMarketConfig() {
    return apiGet<MarketConfig>('/api/v1/config/market');
}

/** validate + save a Fugle API key and hot-swap the market provider */
export function setMarketSource(body: {
    api_key?: string;
    provider?: 'mock' | 'fugle';
}) {
    return apiPost<{ provider: 'mock' | 'fugle'; warning?: string }>(
        '/api/v1/config/market',
        body,
    );
}

// ---- broker (trading) config ----

export type TradeProviderName = 'mock' | 'fubon' | 'nova' | 'esun';

export interface TradeConfig {
    provider: TradeProviderName;
    creds: Record<
        'fubon' | 'nova' | 'esun',
        { env: boolean; saved: boolean }
    >;
}

export function fetchTradeConfig() {
    return apiGet<TradeConfig>('/api/v1/config/trade');
}

/** log in to a broker (or back to mock) and hot-swap trading + market */
export function setTradeSource(body: {
    provider: TradeProviderName;
    id_no?: string;
    password?: string;
    api_key?: string;
    api_secret?: string;
    cert_path?: string;
    cert_pass?: string;
    api_url?: string;
}) {
    return apiPost<{
        provider: TradeProviderName;
        market: MarketProviderName;
        warning?: string;
    }>('/api/v1/config/trade', body);
}

// ---- broker-side condition orders (L1) ----

export interface ConditionOrderRow {
    guid: string;
    code: string;
    action: 'Buy' | 'Sell';
    price: number | null;
    quantity: number;
    account_type: 'S' | 'F';
    status: string;
    raw_status: string;
    tpsl: { stop?: number; take?: number };
    created: string;
}

export function fetchConditionOrders() {
    return apiGet<{ conditions: ConditionOrderRow[] }>(
        '/api/v1/triggers/conditions',
    );
}

export function cancelConditionOrder(guid: string, accountType: 'S' | 'F') {
    return apiDelete<{ ok: boolean }>(
        `/api/v1/triggers/conditions/${encodeURIComponent(guid)}?account_type=${accountType}`,
    );
}

// ---- health / info / auth ----

/** bust server-side account caches (used by the manual refresh button) */
export function refreshAccountCaches() {
    return apiPost<{ ok: boolean }>('/api/v1/portfolio/refresh', {});
}

export function fetchHealth() {
    return apiGet<Health>('/api/v1/health');
}

export function fetchInfo() {
    return apiGet<ServerInfo>('/api/v1/info');
}

export function fetchAccounts() {
    return apiGet<Account[]>('/api/v1/auth/accounts');
}

// ---- contracts ----

export function fetchContract(
    code: string,
    securityType: SecurityType = 'STK',
) {
    const qs = new URLSearchParams({ security_type: securityType ?? '' });
    return apiGet<ContractInfo>(
        `/api/v1/data/contracts/${encodeURIComponent(code)}?${qs.toString()}`,
    );
}

// ---- market data ----

export function fetchSnapshots(contracts: ContractBase[]) {
    return apiPost<Snapshot[]>('/api/v1/data/snapshots', {
        contracts: contracts.map(contractKey),
    });
}

export type MarketSession = 'day' | 'afterhours' | 'all';

export interface SymbolHit {
    code: string;
    name: string;
    type: 'STK' | 'FUT' | 'OPT' | 'IND' | null;
}

export function fetchSymbolSearch(q: string) {
    return apiGet<SymbolHit[]>(
        `/api/v1/data/search?q=${encodeURIComponent(q)}`,
    );
}

export function fetchKbars(
    contract: ContractBase,
    start: string,
    end: string,
    session?: MarketSession,
) {
    return apiPost<KBars>('/api/v1/data/kbars', {
        contract: contractKey(contract),
        start,
        end,
        ...(session ? { session } : {}),
    });
}

export function fetchHistoryTicks(contract: ContractBase, date: string) {
    return apiPost<HistoryTicks>('/api/v1/data/ticks', {
        contract: contractKey(contract),
        date,
    });
}

export function fetchVolumes(contract: ContractBase) {
    return apiPost<VolumeLevel[]>('/api/v1/data/volumes', {
        contract: contractKey(contract),
    });
}

export function fetchLastTicks(
    contract: ContractBase,
    count: number,
    date = todayStr(),
) {
    return apiPost<HistoryTicks>('/api/v1/data/ticks', {
        contract: contractKey(contract),
        date,
        query_type: 'LastCount',
        last_cnt: count,
    });
}

export function fetchScanner(
    scannerType: ScannerType,
    count = 30,
    ascending = false,
) {
    return apiPost<ScannerItem[]>('/api/v1/data/scanner', {
        scanner_type: scannerType,
        date: todayStr(),
        ascending,
        count,
    });
}

// ---- streaming subscriptions ----

export function subscribeQuote(
    contract: ContractBase,
    quoteType: QuoteTypeName,
) {
    const body = {
        ...contractKey(contract),
        target_code: contract.target_code ?? null,
        quote_type: quoteType,
        intraday_odd: false,
    };
    registerSubscription(body);
    return apiPost<SubscriptionResponse>('/api/v1/stream/subscribe', body);
}

export function unsubscribeQuote(
    contract: ContractBase,
    quoteType: QuoteTypeName,
) {
    unregisterSubscription(contract.code, quoteType);
    return apiPost<SubscriptionResponse>('/api/v1/stream/unsubscribe', {
        ...contractKey(contract),
        target_code: contract.target_code ?? null,
        quote_type: quoteType,
        intraday_odd: false,
    });
}

// ---- orders ----

/** optional protective bracket attached to an entry order — armed by the
 *  server when the order fills (offsets resolve against the fill price) */
export interface BracketParam {
    stop?: number;
    take?: number;
    stop_offset?: number;
    take_offset?: number;
    expiry?: 'day' | 'gtc';
    layer?: 'server' | 'broker';
}

export function placeStockOrder(
    contract: ContractBase,
    order: StockOrderReq,
    bracket?: BracketParam,
) {
    return apiPost<Trade & { protection?: string; warning?: string }>(
        '/api/v1/order/place_order',
        {
            contract: contractKey(contract),
            stock_order: order,
            ...(bracket ? { bracket } : {}),
        },
    );
}

export function placeFuturesOrder(
    contract: ContractBase,
    order: FuturesOrderReq,
    bracket?: BracketParam,
) {
    return apiPost<Trade & { protection?: string; warning?: string }>(
        '/api/v1/order/place_order',
        {
            contract: contractKey(contract),
            futures_order: order,
            ...(bracket ? { bracket } : {}),
        },
    );
}

export function cancelOrder(tradeId: string) {
    return apiPost<Trade>('/api/v1/order/cancel_order', { trade_id: tradeId });
}

export function updateOrderPrice(tradeId: string, price: number) {
    return apiPost<Trade>('/api/v1/order/update_price', {
        trade_id: tradeId,
        price,
    });
}

export function updateOrderQty(tradeId: string, quantity: number) {
    return apiPost<Trade>('/api/v1/order/update_qty', {
        trade_id: tradeId,
        quantity,
    });
}

export function fetchTrades(accountType: AccountTypeName) {
    return apiPost<Trade[]>('/api/v1/order/trades', {
        account_type: accountType,
    });
}

// ---- portfolio ----

export function fetchPositions(accountType: AccountTypeName) {
    return apiPost<(StockPosition | FuturePosition)[]>(
        '/api/v1/portfolio/position_unit',
        { account_type: accountType, unit: 'Common' },
    );
}

export function fetchAccountBalance() {
    return apiPost<AccountBalance>('/api/v1/portfolio/account_balance', {
        account_type: 'S',
    });
}

export function fetchMargin() {
    return apiPost<Margin>('/api/v1/portfolio/margin', {
        account_type: 'F',
    });
}

// ---- server watchlists ----

export interface ServerWatchlist {
    id: string;
    name: string;
    contracts: { security_type: SecurityType; exchange: string; code: string }[];
}

export function fetchWatchlists() {
    return apiGet<ServerWatchlist[]>('/api/v1/watchlist');
}

export function createWatchlist(
    name: string,
    contracts: ContractBase[],
) {
    return apiPost<ServerWatchlist>('/api/v1/watchlist', {
        name,
        contracts: contracts.map(contractKey),
    });
}

export function syncWatchlist(id: string, contracts: ContractBase[]) {
    return apiPut<ServerWatchlist>(`/api/v1/watchlist/${id}`, {
        contracts: contracts.map(contractKey),
    });
}
