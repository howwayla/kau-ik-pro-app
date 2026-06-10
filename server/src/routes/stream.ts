// server/src/routes/stream.ts — quote subscriptions + the SSE endpoint

import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import type {
    ContractKey,
    StreamQuoteType,
} from '../providers/market-data.ts';
import type { SubscriptionResponse } from '../types/dto.ts';

interface SubscribeBody extends ContractKey {
    quote_type: string;
    target_code?: string | null;
    intraday_odd?: boolean;
}

function normalizeQuote(quoteType: string): StreamQuoteType[] {
    // shioaji 'Quote' bundles tick + bidask; map it to both internal streams
    if (quoteType === 'Quote') return ['Tick', 'BidAsk'];
    if (quoteType === 'Tick' || quoteType === 'BidAsk') return [quoteType];
    return [];
}

export function registerStreamRoutes(
    app: FastifyInstance,
    ctx: AppContext,
): void {
    app.post<{ Body: SubscribeBody }>(
        '/api/v1/stream/subscribe',
        async (req): Promise<SubscriptionResponse> => {
            const { quote_type, ...key } = req.body;
            try {
                for (const quote of normalizeQuote(quote_type)) {
                    await ctx.subs.subscribe(key, quote);
                }
                return { success: true };
            } catch (err) {
                return {
                    success: false,
                    message: err instanceof Error ? err.message : String(err),
                };
            }
        },
    );

    app.post<{ Body: SubscribeBody }>(
        '/api/v1/stream/unsubscribe',
        async (req): Promise<SubscriptionResponse> => {
            const { quote_type, ...key } = req.body;
            try {
                for (const quote of normalizeQuote(quote_type)) {
                    await ctx.subs.unsubscribe(key, quote);
                }
                return { success: true };
            } catch (err) {
                return {
                    success: false,
                    message: err instanceof Error ? err.message : String(err),
                };
            }
        },
    );

    app.get('/api/v1/stream/data', (req, reply) => {
        reply.hijack();
        ctx.hub.attach(reply.raw);
        req.raw.on('close', () => {
            // hub removes the client on its own close handler
        });
    });
}
