// server/src/routes/triggers.ts — trigger-engine CRUD + status + legacy
// import. The frontend trigger store is a thin client of these endpoints,
// kept in sync via the 'trigger_event' SSE stream.

import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import type { NewTriggerInput } from '../triggers/types.ts';

export function registerTriggerRoutes(
    app: FastifyInstance,
    ctx: AppContext,
): void {
    app.get('/api/v1/triggers', async () => ({
        triggers: ctx.triggers.list(),
        pending_brackets: ctx.triggers.listBrackets(),
    }));

    app.get('/api/v1/triggers/status', async () => ctx.triggers.status());

    app.post<{ Body: NewTriggerInput }>(
        '/api/v1/triggers',
        async (req, reply) => {
            try {
                return ctx.triggers.add(req.body);
            } catch (err) {
                return reply.code(400).send({
                    detail: err instanceof Error ? err.message : String(err),
                });
            }
        },
    );

    app.patch<{
        Params: { id: string };
        Body: { price?: number; quantity?: number };
    }>('/api/v1/triggers/:id', async (req, reply) => {
        try {
            return ctx.triggers.update(req.params.id, req.body ?? {});
        } catch (err) {
            return reply.code(404).send({
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    });

    app.delete<{ Params: { id: string } }>(
        '/api/v1/triggers/:id',
        async (req) => {
            ctx.triggers.remove(req.params.id);
            return { ok: true };
        },
    );

    app.post<{ Params: { id: string } }>(
        '/api/v1/triggers/:id/rearm',
        async (req, reply) => {
            try {
                return ctx.triggers.rearm(req.params.id);
            } catch (err) {
                return reply.code(404).send({
                    detail: err instanceof Error ? err.message : String(err),
                });
            }
        },
    );

    app.post<{
        Body: {
            triggers: (NewTriggerInput & { legacy_broker?: string })[];
        };
    }>('/api/v1/triggers/import', async (req) => {
        const rows = req.body?.triggers ?? [];
        return ctx.triggers.importLegacy(
            rows,
            rows.map((r) => r.legacy_broker),
        );
    });
}
