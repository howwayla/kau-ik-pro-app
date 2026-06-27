import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePositionMetrics } from './position-metrics';
import type { FuturePosition, StockPosition } from './types/portfolio';

const stockPosition = (
    overrides: Partial<StockPosition> = {},
): StockPosition => ({
    id: 1,
    code: '2330',
    direction: 'Buy',
    quantity: 2,
    price: 500,
    last_price: 510,
    pnl: 20_000,
    yd_quantity: 2,
    ...overrides,
});

const futurePosition = (
    overrides: Partial<FuturePosition> = {},
): FuturePosition => ({
    id: 1,
    code: 'TXF202607',
    direction: 'Buy',
    quantity: 1,
    price: 23_000,
    last_price: 23_100,
    pnl: 20_000,
    ...overrides,
});

test('calculates stock market value from display price, lots, and 1000-share multiplier', () => {
    const metrics = calculatePositionMetrics(stockPosition(), {
        displayPriceValue: 510,
    });

    assert.deepEqual(metrics, {
        appliesToStock: true,
        marketValue: 1_020_000,
        unrealizedReturnRate: 2,
    });
});

test('calculates short stock market value as a liability', () => {
    const metrics = calculatePositionMetrics(stockPosition({ direction: 'Sell' }), {
        displayPriceValue: 510,
    });

    assert.equal(metrics.marketValue, -1_020_000);
    assert.equal(metrics.unrealizedReturnRate, 2);
});

test('keeps return rate available when display price is missing', () => {
    const metrics = calculatePositionMetrics(stockPosition(), {
        displayPriceValue: undefined,
    });

    assert.equal(metrics.appliesToStock, true);
    assert.equal(metrics.marketValue, undefined);
    assert.equal(metrics.unrealizedReturnRate, 2);
});

test('returns missing return rate when stock cost is zero', () => {
    const metrics = calculatePositionMetrics(
        stockPosition({ price: 0, pnl: 100 }),
        { displayPriceValue: 50 },
    );

    assert.equal(metrics.appliesToStock, true);
    assert.equal(metrics.marketValue, 100_000);
    assert.equal(metrics.unrealizedReturnRate, undefined);
});

test('does not calculate market value or return rate for futures positions', () => {
    const metrics = calculatePositionMetrics(futurePosition(), {
        displayPriceValue: 23_100,
    });

    assert.deepEqual(metrics, {
        appliesToStock: false,
        marketValue: undefined,
        unrealizedReturnRate: undefined,
    });
});
