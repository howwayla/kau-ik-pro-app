import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    formatMissingPriceCountHint,
    summarizeStockPositions,
} from './portfolio-summary';
import { resolveDisplayPrice } from './display-price';
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
            direction: 'Buy',
            quantity: 2,
            averagePrice: 500,
            pnl: 1200,
            reference: 490,
            displayPrice: price(510, 'close'),
        },
        {
            code: '2317',
            direction: 'Buy',
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
            direction: 'Buy',
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

test('keeps resolved fallback prices when broker last_price is zero and reports missing exclusions', () => {
    const summary = summarizeStockPositions([
        {
            code: '2330',
            direction: 'Buy',
            quantity: 2,
            averagePrice: 500,
            pnl: 1200,
            reference: 490,
            displayPrice: resolveDisplayPrice({
                brokerLastPrice: 0,
                reference: 510,
            }),
        },
        {
            code: '2317',
            direction: 'Buy',
            quantity: 1,
            averagePrice: 100,
            pnl: -100,
            reference: 98,
            displayPrice: resolveDisplayPrice({
                brokerLastPrice: 0,
                reference: 0,
                previousClose: 0,
            }),
        },
    ]);

    assert.equal(summary.totalMarketValue, 1_020_000);
    assert.equal(summary.todayUnrealized, 40_000);
    assert.equal(summary.missingPriceCount, 1);
    assert.equal(
        formatMissingPriceCountHint(summary.missingPriceCount),
        '有 1 筆部位因缺少價格未納入',
    );
    assert.equal(formatMissingPriceCountHint(0), '');
});

test('uses only positions with reference prices for today return basis', () => {
    const summary = summarizeStockPositions([
        {
            code: '2330',
            direction: 'Buy',
            quantity: 1,
            averagePrice: 500,
            pnl: 10_000,
            reference: 490,
            displayPrice: price(510, 'live'),
        },
        {
            code: '9999',
            direction: 'Buy',
            quantity: 1,
            averagePrice: 100,
            pnl: 0,
            reference: undefined,
            displayPrice: price(120, 'live'),
        },
    ]);

    assert.equal(summary.totalMarketValue, 630_000);
    assert.equal(summary.todayUnrealized, 20_000);
    assert.equal(summary.todayBasisValue, 490_000);
});

test('summarizes short stock positions with signed totals', () => {
    const summary = summarizeStockPositions([
        {
            code: '2603',
            direction: 'Sell',
            quantity: 1,
            averagePrice: 100,
            pnl: 10_000,
            reference: 100,
            displayPrice: price(90, 'live'),
        },
    ]);

    assert.equal(summary.totalPnl, 10_000);
    assert.equal(summary.totalCost, -100_000);
    assert.equal(summary.totalMarketValue, -90_000);
    assert.equal(summary.todayBasisValue, -100_000);
    assert.equal(summary.todayUnrealized, 10_000);
});
