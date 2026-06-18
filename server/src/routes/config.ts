// server/src/routes/config.ts — runtime provider settings.
// 行情: paste a Fugle API key from the UI → validated & hot-swapped.
// 券商: dashboard switcher (mock / fubon / nova) → logs in, swaps the
// trading provider, and points market data at the broker's bundled feed.

import type { FastifyInstance } from 'fastify';
import { credsComplete, envBrokerCreds } from '../config.ts';
import type { AppContext } from '../context.ts';
import {
    buildTradingProvider,
    followMarket,
    resolveBrokerCreds,
} from '../provider-switch.ts';
import { FugleMarketDataProvider } from '../providers/fugle/market.ts';
import { MockMarketDataProvider } from '../providers/mock/market.ts';
import { MockTradingProvider } from '../providers/mock/trading.ts';

function publicBrokerMetadata(
    metadata: { certPath?: string; apiUrl?: string } | undefined,
) {
    return metadata
        ? {
              cert_path: metadata.certPath ?? '',
              api_url: metadata.apiUrl ?? '',
          }
        : null;
}

export function registerConfigRoutes(
    app: FastifyInstance,
    ctx: AppContext,
): void {
    app.get('/api/v1/config/market', async () => ({
        provider: ctx.market.name(),
        has_key: Boolean(ctx.runtimeConfig.get().fugleApiKey),
    }));

    app.post<{ Body: { api_key?: string; provider?: 'mock' | 'fugle' } }>(
        '/api/v1/config/market',
        async (req, reply) => {
            const apiKey = req.body?.api_key?.trim();
            const provider = req.body?.provider;

            if (provider === 'mock') {
                const mock = new MockMarketDataProvider();
                await mock.init();
                ctx.hub.clearQuoteCache(); // 清舊行情源殘留，新 snapshot 落乾淨快取
                await ctx.market.swap(mock, 'mock');
                ctx.runtimeConfig.set({ marketProvider: 'mock' });
                return { provider: 'mock' as const };
            }

            const key = apiKey || ctx.runtimeConfig.get().fugleApiKey;
            if (!key) {
                return reply
                    .code(400)
                    .send({ detail: '請提供 Fugle API Key' });
            }
            const fugle = new FugleMarketDataProvider(key);
            try {
                await fugle.init(); // validates the key with a REST probe
            } catch (err) {
                return reply.code(400).send({
                    detail: err instanceof Error ? err.message : String(err),
                });
            }
            // WS auth can hang/fail independently of REST (plan tier,
            // network) — probe once so we can degrade to REST-only polling
            const wsError = await fugle.probeWebSocket();
            ctx.hub.clearQuoteCache();
            await ctx.market.swap(fugle, 'fugle');
            ctx.runtimeConfig.set({ marketProvider: 'fugle', fugleApiKey: key });
            return {
                provider: 'fugle' as const,
                ...(wsError
                    ? {
                          warning: `WebSocket 即時推送不可用（${wsError}）— 已降級為 REST 輪詢模式，報價約每 10 秒更新`,
                      }
                    : {}),
            };
        },
    );

    // ---- 券商切換 ----

    app.get('/api/v1/config/trade', async () => {
        const saved = ctx.runtimeConfig.get().brokerCreds;
        const metadata = ctx.runtimeConfig.get().brokerMetadata;
        return {
            provider: ctx.trading.name(),
            creds: {
                fubon: {
                    env: Boolean(envBrokerCreds('fubon')),
                    saved: credsComplete(saved.fubon) || Boolean(metadata.fubon),
                },
                nova: {
                    env: Boolean(envBrokerCreds('nova')),
                    saved: credsComplete(saved.nova) || Boolean(metadata.nova),
                },
                esun: {
                    env: Boolean(envBrokerCreds('esun')),
                    saved: credsComplete(saved.esun) || Boolean(metadata.esun),
                },
            },
            metadata: {
                fubon: publicBrokerMetadata(metadata.fubon),
                nova: publicBrokerMetadata(metadata.nova),
                esun: publicBrokerMetadata(metadata.esun),
            },
        };
    });

    app.post<{
        Body: {
            provider?: 'mock' | 'fubon' | 'nova' | 'esun';
            cert_path?: string;
            api_url?: string;
        };
    }>('/api/v1/config/trade/metadata', async (req, reply) => {
        const name = req.body?.provider;
        if (!name || !['fubon', 'nova', 'esun'].includes(name)) {
            return reply
                .code(400)
                .send({ detail: 'provider 需為 fubon | nova | esun' });
        }
        const certPath = req.body?.cert_path?.trim();
        if (!certPath) {
            return reply.code(400).send({ detail: '請提供憑證路徑' });
        }
        ctx.runtimeConfig.set({
            tradeProvider: name,
            brokerMetadata: {
                ...ctx.runtimeConfig.get().brokerMetadata,
                [name]: {
                    certPath,
                    apiUrl: req.body?.api_url?.trim() ?? '',
                },
            },
        });
        return { provider: name };
    });

    app.post<{
        Body: {
            provider?: 'mock' | 'fubon' | 'nova' | 'esun';
            id_no?: string;
            password?: string;
            api_key?: string;
            api_secret?: string;
            cert_path?: string;
            cert_pass?: string;
            api_url?: string;
            persist_metadata?: boolean;
        };
    }>('/api/v1/config/trade', async (req, reply) => {
        const name = req.body?.provider;
        if (!name || !['mock', 'fubon', 'nova', 'esun'].includes(name)) {
            return reply
                .code(400)
                .send({ detail: 'provider 需為 mock | fubon | nova | esun' });
        }

        if (name === 'mock') {
            const mock = new MockTradingProvider(ctx.market);
            await mock.init();
            ctx.trading.swap(mock, 'mock');
            ctx.hub.clearQuoteCache();
            const market = await followMarket(
                ctx.market,
                ctx.trading,
                'mock',
                ctx.runtimeConfig,
            );
            ctx.runtimeConfig.set({ tradeProvider: 'mock' });
            return {
                provider: 'mock' as const,
                market: market.name,
                ...(market.warning ? { warning: market.warning } : {}),
            };
        }

        const creds = resolveBrokerCreds(name, ctx.runtimeConfig, {
            idNo: req.body?.id_no?.trim(),
            password: req.body?.password,
            apiKey: req.body?.api_key?.trim(),
            apiSecret: req.body?.api_secret?.trim(),
            certPath: req.body?.cert_path?.trim(),
            certPass: req.body?.cert_pass,
            apiUrl: req.body?.api_url?.trim(),
        });
        if (!creds) {
            const label =
                name === 'fubon' ? '富邦' : name === 'nova' ? '台新' : '玉山';
            return reply.code(400).send({
                detail:
                    `${label} 缺少憑證 — 需要 ${name === 'esun' ? '帳號' : '身分證字號'}、` +
                    `密碼${name === 'fubon' ? '（或 API Key）' : ''}、憑證路徑` +
                    `${name === 'esun' ? '、API Key、API Secret' : ''}`,
            });
        }

        let provider;
        try {
            provider = await buildTradingProvider(
                name,
                ctx.config,
                creds,
                ctx.market,
            );
            await provider.init(); // logs in — may take ~10s
        } catch (err) {
            return reply.code(400).send({
                detail: err instanceof Error ? err.message : String(err),
            });
        }
        ctx.trading.swap(provider, name);
        ctx.hub.clearQuoteCache();
        const market = await followMarket(
            ctx.market,
            ctx.trading,
            name,
            ctx.runtimeConfig,
        );
        if (req.body?.persist_metadata !== false) {
            ctx.runtimeConfig.set({
                tradeProvider: name,
                brokerCreds: {
                    ...ctx.runtimeConfig.get().brokerCreds,
                    [name]: creds,
                },
            });
        }
        return {
            provider: name,
            market: market.name,
            ...(market.warning ? { warning: market.warning } : {}),
        };
    });
}
