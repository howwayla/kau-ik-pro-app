// server/src/triggers/types.ts — server-side trigger/bracket data model.
//
// Protection layering: these are the L2 (local-server) protective orders —
// they survive closed browser tabs but not a dead server. L1 (broker-side
// condition orders, fubon only) lives in the trading provider; L3 (the old
// in-browser engine) was removed when this module landed.

import type { TradeProviderName } from '../config.ts';
import type { MarketName } from '../providers/manager.ts';
import type { ContractKey } from '../providers/market-data.ts';
import type { AccountTypeName, Action } from '../types/dto.ts';

export type TriggerKind = 'stop' | 'take' | 'alert';
export type TriggerExpiry = 'day' | 'gtc';
export type TriggerState = 'active' | 'suspended';
export type SuspendReason =
    | 'crossed_while_down' // price crossed while the server was offline
    | 'broker_switched' // set under a different trading provider
    | 'market_switched' // market source changed — price basis differs
    | 'fire_failed'; // order placement failed at fire time

export interface ServerTrigger {
    id: string;
    contract: ContractKey;
    /** display code — matches SSE tick codes (alias-aware) */
    code: string;
    condition: 'below' | 'above';
    price: number;
    action: Action;
    quantity: number;
    kind: TriggerKind;
    /** OCO group — when one fires, siblings are cancelled */
    group?: string;
    broker: TradeProviderName;
    accountType: AccountTypeName;
    expiry: TriggerExpiry;
    createdAt: number;
    /** YYYY-MM-DD (Asia/Taipei) — day-expiry boundary */
    tradingDay: string;
    state: TriggerState;
    suspendReason?: SuspendReason;
}

export type NewTriggerInput = Omit<
    ServerTrigger,
    'id' | 'createdAt' | 'tradingDay' | 'state' | 'suspendReason' | 'broker' | 'expiry'
> & { expiry?: TriggerExpiry };

export interface PendingBracketRec {
    id: string;
    /** Trade.order.id of the entry order */
    tradeId: string;
    ordno?: string;
    seqno?: string;
    contract: ContractKey;
    code: string;
    action: Action;
    quantity: number;
    /** absolute prices (order ticket) */
    stop?: number;
    take?: number;
    /** relative offsets — resolved against the actual fill price */
    stopOffset?: number;
    takeOffset?: number;
    expiry: TriggerExpiry;
    broker: TradeProviderName;
    accountType: AccountTypeName;
    createdAt: number;
    tradingDay: string;
    /** cumulative deal qty already covered by armed triggers */
    armedQty: number;
}

export type NewBracketInput = Omit<
    PendingBracketRec,
    'id' | 'createdAt' | 'tradingDay' | 'armedQty' | 'broker'
>;

export interface TriggerEngineStatus {
    broker: TradeProviderName;
    market: MarketName;
    feed_mode: 'ws' | 'poll' | 'mock';
    feed_warning?: string;
    active: number;
    suspended: number;
    pending_brackets: number;
    last_price_at: number | null;
}

export type TriggerEventType =
    | 'added'
    | 'updated'
    | 'removed'
    | 'fired'
    | 'fire_skipped'
    | 'fire_failed'
    | 'oco_cancelled'
    | 'suspended'
    | 'rearmed'
    | 'expired'
    | 'bracket_armed'
    | 'bracket_dropped'
    | 'imported';

export interface TriggerEvent {
    type: TriggerEventType;
    trigger?: ServerTrigger;
    bracket?: PendingBracketRec;
    id?: string;
    group?: string;
    message?: string;
    /** fill price for 'fired', import counts for 'imported' */
    price?: number;
    imported?: number;
    dropped?: number;
}

/** YYYY-MM-DD in Asia/Taipei regardless of server TZ */
export function tradingDayToday(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}
