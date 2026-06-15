// server/src/app.ts — Fastify app assembly: routes + provider→SSE wiring.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AppContext } from './context.ts';
import { registerConfigRoutes } from './routes/config.ts';
import { registerDataRoutes } from './routes/data.ts';
import { registerHealthRoutes } from './routes/health.ts';
import { registerOrderRoutes } from './routes/orders.ts';
import { registerPortfolioRoutes } from './routes/portfolio.ts';
import { registerStreamRoutes } from './routes/stream.ts';
import { registerTriggerRoutes } from './routes/triggers.ts';
import { registerWatchlistRoutes } from './routes/watchlist.ts';
import { wireMarketToHub } from './sse/wire-market.ts';

export function buildApp(ctx: AppContext): FastifyInstance {
    const app = Fastify({ logger: { level: 'warn' } });

    // surface provider errors (e.g. broker order rejections) in the
    // {detail} shape the frontend's api.ts fail() reads
    app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
        const status =
            err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
        if (status >= 500) app.log.error(err);
        else if (_req.url?.startsWith('/api/v1/order/')) {
            // order-path rejections (cancel/modify misses, broker refusals)
            // are worth a trace even when they map to 4xx
            app.log.warn({ url: _req.url, detail: err.message });
        }
        void reply.code(status).send({ detail: err.message });
    });

    // CORS for web dev without the vite proxy (and Tauri webviews later)
    app.addHook('onSend', async (_req, reply) => {
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Access-Control-Allow-Headers', 'Content-Type');
        reply.header(
            'Access-Control-Allow-Methods',
            'GET, POST, PUT, PATCH, DELETE, OPTIONS',
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
    registerTriggerRoutes(app, ctx);

    // serve the built frontend (vite build → dist/) so the app is usable
    // directly on this port — API routes above take precedence. The vite
    // dev server (5173, HMR) remains the development entry.
    const distDir = join(
        dirname(fileURLToPath(import.meta.url)),
        '..',
        '..',
        'dist',
    );
    if (existsSync(join(distDir, 'index.html'))) {
        void app.register(fastifyStatic, { root: distDir });
        app.setNotFoundHandler((req, reply) => {
            // SPA fallback for page paths; API misses stay JSON 404s
            if (req.method === 'GET' && !req.url.startsWith('/api/')) {
                return reply.sendFile('index.html');
            }
            void reply.code(404).send({ detail: `not found: ${req.url}` });
        });
    }

    // provider events → SSE fan-out
    wireMarketToHub(ctx.market, ctx.hub);
    ctx.trading.onOrderEvent((ev) => ctx.hub.broadcast('order_event', ev));

    return app;
}
