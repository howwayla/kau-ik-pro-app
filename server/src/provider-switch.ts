// server/src/provider-switch.ts — build trading providers and their
// companion market-data feed. Shared by boot (index.ts) and the dashboard
// switcher route (POST /api/v1/config/trade).
//
// Credential precedence per broker: explicit (request body) → saved
// (server/data/config.json) → environment (FUBON_* / NOVA_* / BROKER_*).

import {
    credsComplete,
    envBrokerCreds,
    type BrokerCreds,
    type BrokerName,
    type Config,
    type TradeProviderName,
} from './config.ts';
import { FugleMarketDataProvider } from './providers/fugle/market.ts';
import type { MarketManager, PriceFeed } from './providers/manager.ts';
import { MockMarketDataProvider } from './providers/mock/market.ts';
import { MockTradingProvider } from './providers/mock/trading.ts';
import type { TradingProvider } from './providers/trading.ts';
import type { RuntimeConfigStore } from './runtime-config.ts';

export function resolveBrokerCreds(
    name: BrokerName,
    runtimeConfig: RuntimeConfigStore,
    explicit?: Partial<BrokerCreds>,
    bootEnvBroker?: BrokerCreds,
): BrokerCreds | null {
    const saved = runtimeConfig.get().brokerCreds[name];
    const env = envBrokerCreds(name) ?? bootEnvBroker;
    // explicit fields overlay the best stored/env base
    const base = credsComplete(saved) ? saved! : (env ?? null);
    const merged: BrokerCreds = {
        idNo: explicit?.idNo || base?.idNo || '',
        password: explicit?.password || base?.password || '',
        apiKey: explicit?.apiKey || base?.apiKey || '',
        apiSecret: explicit?.apiSecret || base?.apiSecret || '',
        certPath: explicit?.certPath || base?.certPath || '',
        certPass: explicit?.certPass || base?.certPass || '',
        apiUrl: explicit?.apiUrl || base?.apiUrl || '',
    };
    return credsComplete(merged) ? merged : null;
}

export async function buildTradingProvider(
    name: TradeProviderName,
    config: Config,
    creds: BrokerCreds | null,
    priceFeed: PriceFeed,
): Promise<TradingProvider> {
    if (name === 'mock') {
        return new MockTradingProvider(priceFeed);
    }
    if (!creds) {
        throw new Error(
            `${name} 缺少憑證 — 請提供 身分證字號 / 密碼${name === 'fubon' ? '（或 API Key）' : ''} / 憑證路徑`,
        );
    }
    const brokerConfig: Config = { ...config, broker: creds };
    if (name === 'fubon') {
        const { FubonTradingProvider } = await import(
            './providers/fubon/trading.ts'
        );
        return new FubonTradingProvider(brokerConfig);
    }
    if (name === 'nova') {
        const { NovaTradingProvider } = await import(
            './providers/nova/trading.ts'
        );
        return new NovaTradingProvider(brokerConfig);
    }
    const { EsunTradingProvider } = await import(
        './providers/esun/trading.ts'
    );
    return new EsunTradingProvider(brokerConfig);
}

export interface MarketSwitchResult {
    name: 'mock' | 'fugle' | 'fubon' | 'nova' | 'esun';
    warning?: string;
}

/**
 * Point the market manager at the feed matching the trading provider:
 * broker → the SDK's bundled market data; mock → the standalone choice
 * the user made in the 行情 menu (fugle key, else mock). Market failures
 * degrade with a warning instead of failing the whole switch.
 */
export async function followMarket(
    market: MarketManager,
    trading: TradingProvider,
    tradeName: TradeProviderName,
    runtimeConfig: RuntimeConfigStore,
): Promise<MarketSwitchResult> {
    if (tradeName !== 'mock' && trading.marketdataSource) {
        const source = trading.marketdataSource();
        if (source) {
            try {
                const provider = new FugleMarketDataProvider(source);
                await provider.init();
                const wsError = await provider.probeWebSocket();
                await market.swap(provider, tradeName);
                return {
                    name: tradeName,
                    ...(wsError
                        ? {
                              warning: `券商行情 WebSocket 不可用（${wsError}）— 已降級為 REST 輪詢`,
                          }
                        : {}),
                };
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return {
                    name: market.name(),
                    warning: `券商行情啟用失敗（${msg}）— 行情來源維持「${market.name()}」`,
                };
            }
        }
    }
    // mock trading → standalone market choice
    const saved = runtimeConfig.get();
    if (saved.marketProvider === 'fugle' && saved.fugleApiKey) {
        try {
            const fugle = new FugleMarketDataProvider(saved.fugleApiKey);
            await fugle.init();
            await fugle.probeWebSocket();
            await market.swap(fugle, 'fugle');
            return { name: 'fugle' };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const mock = new MockMarketDataProvider();
            await mock.init();
            await market.swap(mock, 'mock');
            return {
                name: 'mock',
                warning: `富果行情連線失敗（${msg}）— 已退回模擬行情`,
            };
        }
    }
    if (market.name() !== 'mock') {
        const mock = new MockMarketDataProvider();
        await mock.init();
        await market.swap(mock, 'mock');
    }
    return { name: 'mock' };
}
