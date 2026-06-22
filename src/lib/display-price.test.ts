import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDisplayPrice } from './display-price';

test('uses live tick when it is positive', () => {
    assert.deepEqual(
        resolveDisplayPrice({
            tickClose: 101,
            snapshotClose: 99,
            brokerLastPrice: 98,
            reference: 97,
            previousClose: 96,
        }),
        {
            value: 101,
            source: 'live',
            label: '即時',
            title: '即時成交價',
        },
    );
});

test('ignores trial matching ticks as live prices', () => {
    const price = resolveDisplayPrice({
        tickClose: 101,
        tickSimtrade: true,
        snapshotClose: 99,
        brokerLastPrice: 98,
        reference: 97,
    });

    assert.equal(price.value, 99);
    assert.equal(price.source, 'close');
});

test('uses snapshot close when live tick is missing', () => {
    const price = resolveDisplayPrice({
        snapshotClose: 88.4,
        brokerLastPrice: 0,
        reference: 86,
        previousClose: 85,
    });
    assert.equal(price.value, 88.4);
    assert.equal(price.source, 'close');
    assert.equal(price.label, '收盤');
});

test('ignores broker last_price 0 and falls through to reference', () => {
    const price = resolveDisplayPrice({
        brokerLastPrice: 0,
        reference: 42,
        previousClose: 41,
    });
    assert.equal(price.value, 42);
    assert.equal(price.source, 'reference');
    assert.equal(price.label, '參考');
});

test('uses broker price only when it is positive and no market fallback exists', () => {
    const price = resolveDisplayPrice({
        brokerLastPrice: 53.2,
        reference: 0,
        previousClose: 0,
    });
    assert.equal(price.value, 53.2);
    assert.equal(price.source, 'broker');
    assert.equal(price.label, '券商');
});

test('returns missing when every source is empty or invalid', () => {
    assert.deepEqual(
        resolveDisplayPrice({
            tickClose: 0,
            snapshotClose: 0,
            brokerLastPrice: 0,
            reference: 0,
            previousClose: 0,
        }),
        {
            value: undefined,
            source: 'missing',
            label: '無資料',
            title: '沒有可用價格',
        },
    );
});
