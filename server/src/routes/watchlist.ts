// server/src/routes/watchlist.ts — server-side watchlist persistence

import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import type { ServerWatchlist } from '../types/dto.ts';

export function registerWatchlistRoutes(
    app: FastifyInstance,
    ctx: AppContext,
): void {
    app.get('/api/v1/watchlist', async () => ctx.watchlists.all());

    app.post<{
        Body: { name: string; contracts: ServerWatchlist['contracts'] };
    }>('/api/v1/watchlist', async (req) =>
        ctx.watchlists.create(req.body.name, req.body.contracts ?? []),
    );

    app.put<{
        Params: { id: string };
        Body: { contracts: ServerWatchlist['contracts'] };
    }>('/api/v1/watchlist/:id', async (req, reply) => {
        const updated = ctx.watchlists.update(
            req.params.id,
            req.body.contracts ?? [],
        );
        if (!updated) {
            return reply
                .code(404)
                .send({ detail: `watchlist not found: ${req.params.id}` });
        }
        return updated;
    });
}
