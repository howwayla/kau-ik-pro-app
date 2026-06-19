import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeStockPositions } from './portfolio-summary';
import type { DisplayPrice } from './display-price';

const price = (
    value: number | undefined,
    source: DisplayPrice['source'],
): DisplayPrice => ({
    value,
    source,
    label: source === 'missing' ? '無資料' : source === 'close' ? '收盤' : '參考',
    title: source,
});

test('includes fallback display prices in total market value', () => {
    const summary = summarizeStockPositions([
        {
            code: '2330',
            quantity: 2,
            averagePrice: 500,
            pnl: 1200,
            reference: 490,
            displayPrice: price(510, 'close'),
        },
        {
            code: '2317',
            quantity: 1,
            averagePrice: 100,
            pnl: 0,
            reference: 98,
            displayPrice: price(99, 'reference'),
        },
    ]);

    assert.equal(summary.totalMarketValue, 1_119_000);
    assert.equal(summary.totalCost, 1_100_000);
    assert.equal(summary.missingPriceCount, 0);
});

test('excludes only positions with no display price', () => {
    const summary = summarizeStockPositions([
        {
            code: '2330',
            quantity: 2,
            averagePrice: 500,
            pnl: 1200,
            reference: 490,
            displayPrice: price(undefined, 'missing'),
        },
    ]);

    assert.equal(summary.totalMarketValue, 0);
    assert.equal(summary.todayUnrealized, 0);
    assert.equal(summary.missingPriceCount, 1);
});
