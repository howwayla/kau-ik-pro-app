// server/src/routes/data.ts — contracts, snapshots, kbars, ticks, scanner,
// chips (credit/short/punish)

import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import type { ContractKey } from '../providers/market-data.ts';
import type {
    MarketSession,
    ScannerType,
    SecurityType,
} from '../types/dto.ts';

interface ContractsQuery {
    security_type?: string;
}

export function registerDataRoutes(
    app: FastifyInstance,
    ctx: AppContext,
): void {
    app.get<{ Params: { code: string }; Querystring: ContractsQuery }>(
        '/api/v1/data/contracts/:code',
        async (req, reply) => {
            const type = (req.query.security_type || 'STK') as SecurityType;
            const contract = await ctx.market.resolveContract(
                req.params.code,
                type,
            );
            if (!contract) {
                return reply
                    .code(404)
                    .send({ detail: `contract not found: ${req.params.code}` });
            }
            return contract;
        },
    );

    app.post<{ Body: { security_type?: string; page?: number } }>(
        '/api/v1/data/contracts',
        async (req, reply) => {
            if (req.body?.security_type !== 'OPT') {
                return reply.code(400).send({
                    detail: 'only security_type=OPT listing is supported',
                });
            }
            return { contracts: await ctx.market.listOptionContracts() };
        },
    );

    app.post<{ Body: { contracts?: ContractKey[] } }>(
        '/api/v1/data/snapshots',
        async (req) => ctx.market.snapshots(req.body?.contracts ?? []),
    );

    app.post<{
        Body: {
            contract: ContractKey;
            start: string;
            end: string;
            session?: MarketSession;
        };
    }>('/api/v1/data/kbars', async (req) =>
        ctx.market.kbars(
            req.body.contract,
            req.body.start,
            req.body.end,
            req.body.session,
        ),
    );

    app.post<{ Body: { contract: ContractKey } }>(
        '/api/v1/data/volumes',
        async (req) => ctx.market.volumes(req.body.contract),
    );

    app.post<{
        Body: {
            contract: ContractKey;
            date: string;
            query_type?: string;
            last_cnt?: number;
        };
    }>('/api/v1/data/ticks', async (req) =>
        ctx.market.ticks(
            req.body.contract,
            req.body.date,
            req.body.query_type === 'LastCount' ? req.body.last_cnt : undefined,
        ),
    );

    app.post<{
        Body: {
            scanner_type: ScannerType;
            count?: number;
            ascending?: boolean;
        };
    }>('/api/v1/data/scanner', async (req) =>
        ctx.market.scanner(
            req.body.scanner_type,
            req.body.count ?? 30,
            req.body.ascending ?? false,
        ),
    );

    app.post<{ Body: { contracts?: ContractKey[] } }>(
        '/api/v1/data/credit_enquire',
        async (req) => ctx.market.creditEnquire(req.body?.contracts ?? []),
    );

    app.post<{ Body: { contracts?: ContractKey[] } }>(
        '/api/v1/data/short_stock_sources',
        async (req) => ctx.market.shortStockSources(req.body?.contracts ?? []),
    );

    app.get('/api/v1/data/regulatory_punish', async () =>
        ctx.market.regulatoryPunish(),
    );
}
