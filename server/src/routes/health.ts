// server/src/routes/health.ts — /health, /info, /auth/accounts

import type { FastifyInstance } from 'fastify';
import { SERVER_VERSION, type AppContext } from '../context.ts';
import type { Health, ServerInfo } from '../types/dto.ts';

export function registerHealthRoutes(
    app: FastifyInstance,
    ctx: AppContext,
): void {
    app.get('/api/v1/health', async (): Promise<Health> => ({
        status: 'ok',
        version: SERVER_VERSION,
        timestamp: new Date().toISOString(),
        token_expires_in_seconds: 86_400,
        token_stale: false,
        contract_count: ctx.market.contractCount(),
        next_maintenance: '',
    }));

    app.get('/api/v1/info', async (): Promise<ServerInfo> => ({
        name: 'kau-ik-pro-server',
        version: SERVER_VERSION,
        description:
            'Kau-ik Pro local server — trading via Fubon/Taishin SDK, market data via Fugle',
        protocols: ['http', 'sse'],
        simulation:
            ctx.trading.name() === 'mock' || ctx.market.name() === 'mock',
        capabilities: {
            futures_trading: ctx.trading.capabilities().futures,
            condition_orders: ctx.trading.capabilities().condition_orders,
        },
    }));

    app.get('/api/v1/auth/accounts', async () => ctx.trading.accounts());
}
