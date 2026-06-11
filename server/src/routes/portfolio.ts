// server/src/routes/portfolio.ts — positions, balance, margin, P&L

import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import type { AccountTypeName } from '../types/dto.ts';

export function registerPortfolioRoutes(
    app: FastifyInstance,
    ctx: AppContext,
): void {
    app.post<{ Body: { account_type: AccountTypeName; unit?: string } }>(
        '/api/v1/portfolio/position_unit',
        async (req) => ctx.trading.positions(req.body.account_type),
    );

    app.post('/api/v1/portfolio/account_balance', async () =>
        ctx.trading.accountBalance(),
    );

    app.post('/api/v1/portfolio/margin', async () => ctx.trading.margin());

    // manual refresh: bust the manager's read caches so the next queries
    // hit the broker for fresh data
    app.post('/api/v1/portfolio/refresh', async () => {
        ctx.trading.bustReadCaches();
        return { ok: true };
    });

    app.post<{
        Body: {
            begin_date: string;
            end_date: string;
            account_type: AccountTypeName;
            unit?: string;
        };
    }>('/api/v1/portfolio/profit_loss', async (req) =>
        ctx.trading.profitLoss(
            req.body.begin_date,
            req.body.end_date,
            req.body.account_type,
        ),
    );
}
