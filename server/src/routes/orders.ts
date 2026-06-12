// server/src/routes/orders.ts — place / cancel / modify / list orders

import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import type { ContractKey } from '../providers/market-data.ts';
import {
    ConditionOrderError,
    TradeNotFoundError,
} from '../providers/trading.ts';
import type {
    AccountTypeName,
    FuturesOrderReq,
    StockOrderReq,
} from '../types/dto.ts';

interface BracketBody {
    stop?: number;
    take?: number;
    stop_offset?: number;
    take_offset?: number;
    expiry?: 'day' | 'gtc';
    /** 'broker' = fubon condition order with TPSL children (L1);
     *  'server' (default) = local trigger engine OCO (L2) */
    layer?: 'server' | 'broker';
}

interface PlaceOrderBody {
    contract: ContractKey;
    stock_order?: StockOrderReq;
    futures_order?: FuturesOrderReq;
    bracket?: BracketBody;
}

export function registerOrderRoutes(
    app: FastifyInstance,
    ctx: AppContext,
): void {
    app.post<{ Body: PlaceOrderBody }>(
        '/api/v1/order/place_order',
        async (req, reply) => {
            const { contract, stock_order, futures_order, bracket } = req.body;
            const order = stock_order ?? futures_order;
            if (!order) {
                return reply
                    .code(400)
                    .send({ detail: 'stock_order or futures_order required' });
            }
            if (futures_order && !ctx.trading.capabilities().futures) {
                return reply.code(400).send({
                    detail: '此券商不支援期貨/選擇權下單',
                });
            }

            const hasBracket =
                bracket &&
                (bracket.stop !== undefined ||
                    bracket.take !== undefined ||
                    bracket.stop_offset !== undefined ||
                    bracket.take_offset !== undefined);

            // L1: broker-side condition order with TP/SL children — the
            // entry itself is the condition order (no plain order placed).
            // Absolute prices only: offsets need a fill price, which the
            // broker resolves itself via the TPSL children.
            let brokerWarning: string | undefined;
            if (
                hasBracket &&
                bracket.layer === 'broker' &&
                (bracket.stop !== undefined || bracket.take !== undefined)
            ) {
                try {
                    const spec = {
                        stop: bracket.stop,
                        take: bracket.take,
                        expiry: bracket.expiry ?? ('day' as const),
                    };
                    const { guid } = stock_order
                        ? await ctx.trading.placeStockBracketCondition(
                              contract,
                              stock_order,
                              spec,
                          )
                        : await ctx.trading.placeFuturesBracketCondition(
                              contract,
                              futures_order!,
                              spec,
                          );
                    // synthesized Trade-shaped response so existing UI
                    // feedback paths keep working
                    return {
                        contract: {
                            ...contract,
                            target_code: null,
                        },
                        order: {
                            id: `cond-${guid}`,
                            seqno: '',
                            ordno: guid.slice(0, 8),
                            action: order.action,
                            price: order.price,
                            quantity: order.quantity,
                        },
                        status: {
                            id: `cond-${guid}`,
                            status: 'PreSubmitted',
                            status_code: '00',
                            order_quantity: order.quantity,
                            deal_quantity: 0,
                            cancel_quantity: 0,
                            modified_price: 0,
                            msg: '券商端條件單',
                            deals: [],
                        },
                        protection: 'broker' as const,
                        condition_guid: guid,
                    };
                } catch (err) {
                    if (!(err instanceof ConditionOrderError)) throw err;
                    brokerWarning = `券商條件單失敗（${err.message}）— 已改用本機伺服器保護`;
                }
            }

            const trade = stock_order
                ? await ctx.trading.placeStockOrder(contract, stock_order)
                : await ctx.trading.placeFuturesOrder(contract, futures_order!);

            if (!hasBracket) return trade;

            // L2 server bracket: armed on fill via order events
            ctx.triggers.registerBracket({
                tradeId: trade.order.id,
                ordno: trade.order.ordno || undefined,
                seqno: trade.order.seqno || undefined,
                contract,
                code: contract.code,
                action: order.action,
                quantity: order.quantity,
                stop: bracket.stop,
                take: bracket.take,
                stopOffset: bracket.stop_offset,
                takeOffset: bracket.take_offset,
                expiry: bracket.expiry ?? 'day',
                accountType: futures_order ? 'F' : 'S',
            });
            return {
                ...trade,
                protection: 'server' as const,
                ...(brokerWarning ? { warning: brokerWarning } : {}),
            };
        },
    );

    const withTrade = async <T>(
        fn: () => Promise<T>,
        reply: { code: (c: number) => { send: (b: unknown) => unknown } },
    ): Promise<T | unknown> => {
        try {
            return await fn();
        } catch (err) {
            if (err instanceof TradeNotFoundError) {
                return reply.code(404).send({ detail: err.message });
            }
            throw err;
        }
    };

    app.post<{ Body: { trade_id: string } }>(
        '/api/v1/order/cancel_order',
        async (req, reply) =>
            withTrade(() => ctx.trading.cancel(req.body.trade_id), reply),
    );

    app.post<{ Body: { trade_id: string; price: number } }>(
        '/api/v1/order/update_price',
        async (req, reply) =>
            withTrade(
                () => ctx.trading.updatePrice(req.body.trade_id, req.body.price),
                reply,
            ),
    );

    app.post<{ Body: { trade_id: string; quantity: number } }>(
        '/api/v1/order/update_qty',
        async (req, reply) =>
            withTrade(
                () => ctx.trading.updateQty(req.body.trade_id, req.body.quantity),
                reply,
            ),
    );

    app.post<{ Body: { account_type: AccountTypeName } }>(
        '/api/v1/order/trades',
        async (req) => ctx.trading.trades(req.body.account_type),
    );
}
