// server/src/index.ts — entry point: pick providers from env/saved config
// and listen.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import type { AppContext } from './context.ts';
import { FugleMarketDataProvider } from './providers/fugle/market.ts';
import { MarketManager } from './providers/manager.ts';
import { MockMarketDataProvider } from './providers/mock/market.ts';
import { MockTradingProvider } from './providers/mock/trading.ts';
import type { TradingProvider } from './providers/trading.ts';
import { RuntimeConfigStore } from './runtime-config.ts';
import { SseHub } from './sse/hub.ts';
import { SubscriptionRegistry } from './sse/subscriptions.ts';
import { WatchlistStore } from './watchlist-store.ts';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');

async function main(): Promise<void> {
    const config = loadConfig();
    const runtimeConfig = new RuntimeConfigStore(join(dataDir, 'config.json'), {
        marketProvider: config.marketProvider,
        fugleApiKey: config.fugleApiKey,
    });

    const manager = new MarketManager();
    const saved = runtimeConfig.get();
    let started = false;
    if (saved.marketProvider === 'fugle' && saved.fugleApiKey) {
        const fugle = new FugleMarketDataProvider(saved.fugleApiKey);
        try {
            await fugle.init();
            manager.start(fugle, 'fugle');
            started = true;
            console.log('market: fugle (saved API key)');
        } catch (err) {
            console.warn(
                `fugle init failed (${err instanceof Error ? err.message : err}) — falling back to mock`,
            );
        }
    }
    if (!started) {
        const mock = new MockMarketDataProvider();
        await mock.init();
        manager.start(mock, 'mock');
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
            // paper trading priced off the live market feed (mock or fugle)
            trading = new MockTradingProvider(manager);
    }

    await trading.init();

    const ctx: AppContext = {
        config,
        market: manager,
        trading,
        hub: new SseHub(),
        subs: new SubscriptionRegistry(manager),
        watchlists: new WatchlistStore(join(dataDir, 'watchlists.json')),
        runtimeConfig,
        startedAt: Date.now(),
    };

    const app = buildApp(ctx);
    await app.listen({ port: config.port, host: config.host });
    console.log(
        `nova-pro-server listening on http://${config.host}:${config.port}` +
            ` (market=${manager.name()}, trade=${config.tradeProvider})`,
    );
}

main().catch((err) => {
    console.error('fatal:', err instanceof Error ? err.message : err);
    process.exit(1);
});
