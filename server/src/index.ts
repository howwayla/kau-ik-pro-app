// server/src/index.ts — entry point: pick providers from env/saved config
// and listen.
//
// Trade provider resolution: TRADE_PROVIDER env (explicit) wins, else the
// provider last picked in the dashboard switcher (server/data/config.json),
// else mock. Broker login failures fall back to mock so the app always
// boots — switch again from the dashboard once the problem is fixed.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.ts';
import { credsComplete, loadConfig } from './config.ts';
import type { AppContext } from './context.ts';
import {
    buildTradingProvider,
    followMarket,
    resolveBrokerCreds,
} from './provider-switch.ts';
import { MarketManager } from './providers/manager.ts';
import { MockMarketDataProvider } from './providers/mock/market.ts';
import { MockTradingProvider } from './providers/mock/trading.ts';
import { TradingManager } from './providers/trading-manager.ts';
import { RuntimeConfigStore } from './runtime-config.ts';
import { SseHub } from './sse/hub.ts';
import { TriggerEngine } from './triggers/engine.ts';
import { TriggerStore } from './triggers/store.ts';
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

    // start on mock market; followMarket below picks the real feed
    const market = new MarketManager();
    const mockMarket = new MockMarketDataProvider();
    await mockMarket.init();
    market.start(mockMarket, 'mock');

    const trading = new TradingManager();
    const tradeName = process.env.TRADE_PROVIDER
        ? config.tradeProvider
        : runtimeConfig.get().tradeProvider;

    let activeTradeName = tradeName;
    if (tradeName === 'mock') {
        const mock = new MockTradingProvider(market);
        await mock.init();
        trading.start(mock, 'mock');
    } else {
        try {
            const creds = resolveBrokerCreds(
                tradeName,
                runtimeConfig,
                undefined,
                credsComplete(config.broker) ? config.broker : undefined,
            );
            const provider = await buildTradingProvider(
                tradeName,
                config,
                creds,
                market,
            );
            await provider.init();
            trading.start(provider, tradeName);
        } catch (err) {
            console.warn(
                `${tradeName} 啟用失敗（${err instanceof Error ? err.message : err}）— 退回 mock，可從 dashboard 重新切換`,
            );
            const mock = new MockTradingProvider(market);
            await mock.init();
            trading.start(mock, 'mock');
            activeTradeName = 'mock';
        }
    }

    const marketResult = await followMarket(
        market,
        trading,
        activeTradeName,
        runtimeConfig,
    );
    if (marketResult.warning) console.warn(marketResult.warning);

    const hub = new SseHub();
    const triggers = new TriggerEngine(
        market,
        trading,
        hub,
        new TriggerStore(join(dataDir, 'triggers.json')),
    );
    await triggers.start();

    const ctx: AppContext = {
        config,
        market,
        trading,
        hub,
        subs: new SubscriptionRegistry(market),
        watchlists: new WatchlistStore(join(dataDir, 'watchlists.json')),
        runtimeConfig,
        triggers,
        startedAt: Date.now(),
    };

    const app = buildApp(ctx);
    await app.listen({ port: config.port, host: config.host });
    console.log(
        `nova-pro-server listening on http://${config.host}:${config.port}` +
            ` (market=${market.name()}, trade=${trading.name()})`,
    );
}

main().catch((err) => {
    console.error('fatal:', err instanceof Error ? err.message : err);
    process.exit(1);
});
