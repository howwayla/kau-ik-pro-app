// server/src/context.ts — shared wiring passed to every route module.

import type { Config } from './config.ts';
import type { MarketDataProvider } from './providers/market-data.ts';
import type { TradingProvider } from './providers/trading.ts';
import type { SseHub } from './sse/hub.ts';
import type { SubscriptionRegistry } from './sse/subscriptions.ts';
import type { WatchlistStore } from './watchlist-store.ts';

export interface AppContext {
    config: Config;
    market: MarketDataProvider;
    trading: TradingProvider;
    hub: SseHub;
    subs: SubscriptionRegistry;
    watchlists: WatchlistStore;
    startedAt: number;
}

export const SERVER_VERSION = '0.1.0';
