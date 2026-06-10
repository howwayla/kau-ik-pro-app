// server/src/routes/config.ts — runtime market-source settings.
// Lets the user paste their own Fugle API key from the UI; the key is
// validated against the Fugle REST API before being persisted and the
// market provider is hot-swapped without dropping the SSE connection.

import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { FugleMarketDataProvider } from '../providers/fugle/market.ts';
import { MockMarketDataProvider } from '../providers/mock/market.ts';

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
            await ctx.market.swap(fugle, 'fugle');
            ctx.runtimeConfig.set({ marketProvider: 'fugle', fugleApiKey: key });
            return { provider: 'fugle' as const };
        },
    );
}
