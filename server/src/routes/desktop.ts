import type { FastifyInstance } from 'fastify';
import { desktopIdentitySignature } from '../desktop-auth.ts';

export function registerDesktopRoutes(app: FastifyInstance): void {
    app.get<{ Querystring: { nonce?: string } }>(
        '/api/v1/desktop/identity',
        async (req, reply) => {
            const token = process.env.KAUIK_DESKTOP_AUTH_TOKEN;
            const nonce = req.query?.nonce?.trim();
            if (!token || !nonce) {
                return reply.code(404).send({ detail: 'not found' });
            }
            return {
                ok: true,
                signature: desktopIdentitySignature(token, nonce),
            };
        },
    );
}
