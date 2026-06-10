// server/src/app.ts — Fastify app assembly: routes + provider→SSE wiring.

import Fastify, { type FastifyInstance } from 'fastify';
import type { AppContext } from './context.ts';
import { registerConfigRoutes } from './routes/config.ts';
import { registerDataRoutes } from './routes/data.ts';
import { registerHealthRoutes } from './routes/health.ts';
import { registerOrderRoutes } from './routes/orders.ts';
import { registerPortfolioRoutes } from './routes/portfolio.ts';
import { registerStreamRoutes } from './routes/stream.ts';
import { registerWatchlistRoutes } from './routes/watchlist.ts';

export function buildApp(ctx: AppContext): FastifyInstance {
    const app = Fastify({ logger: { level: 'warn' } });

    // CORS for web dev without the vite proxy (and Tauri webviews later)
    app.addHook('onSend', async (_req, reply) => {
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Access-Control-Allow-Headers', 'Content-Type');
        reply.header(
            'Access-Control-Allow-Methods',
            'GET, POST, PUT, OPTIONS',
        );
    });
    app.options('/*', async (_req, reply) => reply.code(204).send());

    registerHealthRoutes(app, ctx);
    registerConfigRoutes(app, ctx);
    registerDataRoutes(app, ctx);
    registerStreamRoutes(app, ctx);
    registerOrderRoutes(app, ctx);
    registerPortfolioRoutes(app, ctx);
    registerWatchlistRoutes(app, ctx);

    // provider events → SSE fan-out
    ctx.market.onTick((channel, tick) => ctx.hub.broadcast(channel, tick));
    ctx.market.onBidAsk((channel, bidask) =>
        ctx.hub.broadcast(channel, bidask),
    );
    ctx.trading.onOrderEvent((ev) => ctx.hub.broadcast('order_event', ev));

    return app;
}
