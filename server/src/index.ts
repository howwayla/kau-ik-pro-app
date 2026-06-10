// server/src/index.ts — entry point: pick providers from env and listen.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import type { AppContext } from './context.ts';
import type { MarketDataProvider } from './providers/market-data.ts';
import { MockMarketDataProvider } from './providers/mock/market.ts';
import { MockTradingProvider } from './providers/mock/trading.ts';
import type { TradingProvider } from './providers/trading.ts';
import { SseHub } from './sse/hub.ts';
import { SubscriptionRegistry } from './sse/subscriptions.ts';
import { WatchlistStore } from './watchlist-store.ts';

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
    const config = loadConfig();

    let market: MarketDataProvider;
    const mockMarket = new MockMarketDataProvider();
    if (config.marketProvider === 'fugle') {
        const { FugleMarketDataProvider } = await import(
            './providers/fugle/market.ts'
        );
        // stub until Phase 2 — init() throws with a clear message
        market = new FugleMarketDataProvider(config) as unknown as MarketDataProvider;
    } else {
        market = mockMarket;
    }

    let trading: TradingProvider;
    switch (config.tradeProvider) {
        case 'fubon': {
            const { FubonTradingProvider } = await import(
                './providers/fubon/trading.ts'
            );
            trading = new FubonTradingProvider(config);
            break;
        }
        case 'nova': {
            const { NovaTradingProvider } = await import(
                './providers/nova/trading.ts'
            );
            trading = new NovaTradingProvider(config);
            break;
        }
        default:
            // mock trading prices fills off the mock engine; when paired
            // with the fugle market provider it still uses mock prices
            trading = new MockTradingProvider(mockMarket.engine);
    }

    await market.init();
    await trading.init();

    const ctx: AppContext = {
        config,
        market,
        trading,
        hub: new SseHub(),
        subs: new SubscriptionRegistry(market),
        watchlists: new WatchlistStore(
            join(here, '..', 'data', 'watchlists.json'),
        ),
        startedAt: Date.now(),
    };

    const app = buildApp(ctx);
    await app.listen({ port: config.port, host: config.host });
    console.log(
        `nova-pro-server listening on http://${config.host}:${config.port}` +
            ` (market=${config.marketProvider}, trade=${config.tradeProvider})`,
    );
}

main().catch((err) => {
    console.error('fatal:', err instanceof Error ? err.message : err);
    process.exit(1);
});
