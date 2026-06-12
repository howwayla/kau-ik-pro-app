// server/src/context.ts — shared wiring passed to every route module.

import type { Config } from './config.ts';
import type { MarketManager } from './providers/manager.ts';
import type { TradingManager } from './providers/trading-manager.ts';
import type { RuntimeConfigStore } from './runtime-config.ts';
import type { SseHub } from './sse/hub.ts';
import type { SubscriptionRegistry } from './sse/subscriptions.ts';
import type { TriggerEngine } from './triggers/engine.ts';
import type { WatchlistStore } from './watchlist-store.ts';

export interface AppContext {
    config: Config;
    market: MarketManager;
    trading: TradingManager;
    hub: SseHub;
    subs: SubscriptionRegistry;
    watchlists: WatchlistStore;
    runtimeConfig: RuntimeConfigStore;
    triggers: TriggerEngine;
    startedAt: number;
}

export const SERVER_VERSION = '0.1.0';
