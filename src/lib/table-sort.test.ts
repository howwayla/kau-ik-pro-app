import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    compareNullable,
    createMemorySortStorage,
    createOrderTimeDescendingCompare,
    loadSortState,
    saveSortState,
    stableSort,
    toggleSort,
    type SortState,
} from './table-sort';

test('stableSort preserves input order for equal values', () => {
    const rows = [
        { id: 'a', value: 1 },
        { id: 'b', value: 1 },
        { id: 'c', value: 2 },
    ];
    const sorted = stableSort(rows, () => 0);
    assert.deepEqual(sorted.map((row) => row.id), ['a', 'b', 'c']);
});

test('compareNullable pushes missing values last in ascending and descending', () => {
    assert.equal(compareNullable(undefined, 1, 'asc'), 1);
    assert.equal(compareNullable(1, undefined, 'asc'), -1);
    assert.equal(compareNullable(undefined, 1, 'desc'), 1);
    assert.equal(compareNullable(1, undefined, 'desc'), -1);
    assert.equal(compareNullable(null, 1, 'asc'), 1);
    assert.equal(compareNullable(1, null, 'asc'), -1);
    assert.equal(compareNullable(null, 1, 'desc'), 1);
    assert.equal(compareNullable(1, null, 'desc'), -1);
});

test('stableSort with compareNullable sorts market values and keeps missing values last', () => {
    const rows = [
        { id: 'missing', marketValue: undefined },
        { id: 'large', marketValue: 2_000_000 },
        { id: 'small', marketValue: 100_000 },
    ];

    const ascending = stableSort(rows, (a, b) =>
        compareNullable(a.marketValue, b.marketValue, 'asc'),
    );
    assert.deepEqual(ascending.map((row) => row.id), [
        'small',
        'large',
        'missing',
    ]);

    const descending = stableSort(rows, (a, b) =>
        compareNullable(a.marketValue, b.marketValue, 'desc'),
    );
    assert.deepEqual(descending.map((row) => row.id), [
        'large',
        'small',
        'missing',
    ]);
});

test('sort state accepts new position metric keys', () => {
    const storage = createMemorySortStorage();
    const allowed = ['marketValue', 'returnRate'] as const;

    saveSortState(storage, 'kau-ik-pro-positions-sort', {
        key: 'returnRate',
        direction: 'desc',
    });

    assert.deepEqual(
        loadSortState(storage, 'kau-ik-pro-positions-sort', allowed),
        { key: 'returnRate', direction: 'desc' },
    );
});

test('sort state round trips through storage only when key and direction are valid', () => {
    const storage = createMemorySortStorage();
    const allowed = ['symbol', 'pnl'] as const;
    const state: SortState<'symbol' | 'pnl'> = { key: 'pnl', direction: 'desc' };
    saveSortState(storage, 'kau-ik-pro-positions-sort', state);
    assert.deepEqual(
        loadSortState(storage, 'kau-ik-pro-positions-sort', allowed),
        state,
    );

    storage.setItem(
        'kau-ik-pro-positions-sort',
        JSON.stringify({ key: 'bad', direction: 'up' }),
    );
    assert.equal(loadSortState(storage, 'kau-ik-pro-positions-sort', allowed), null);
});

test('toggleSort uses the supplied default direction for a new key', () => {
    const current: SortState<'symbol' | 'pnl'> = { key: 'symbol', direction: 'asc' };
    assert.deepEqual(toggleSort(current, 'pnl', 'desc'), {
        key: 'pnl',
        direction: 'desc',
    });
});

test('toggleSort toggles the same key between ascending and descending', () => {
    const descending = toggleSort<'pnl'>({ key: 'pnl', direction: 'asc' }, 'pnl');
    assert.deepEqual(descending, { key: 'pnl', direction: 'desc' });
    assert.deepEqual(toggleSort(descending, 'pnl'), { key: 'pnl', direction: 'asc' });
});

test('order time compare uses order_ts when every row has one', () => {
    const rows = [
        { id: 'old', orderTs: 100, fallbackRank: 1 },
        { id: 'new', orderTs: 200, fallbackRank: 0 },
    ];
    const sorted = stableSort(rows, createOrderTimeDescendingCompare(rows));
    assert.deepEqual(sorted.map((row) => row.id), ['new', 'old']);
});

test('order time compare falls back to current reversed rank when any order_ts is missing', () => {
    const rows = [
        { id: 'first-original', orderTs: undefined, fallbackRank: 1 },
        { id: 'last-original', orderTs: 200, fallbackRank: 0 },
    ];
    const sorted = stableSort(rows, createOrderTimeDescendingCompare(rows));
    assert.deepEqual(sorted.map((row) => row.id), ['last-original', 'first-original']);
});

test('order time compare uses fallback rank for the whole batch when one order_ts is missing', () => {
    const rows = [
        { id: 'fallback-first', orderTs: 100, fallbackRank: 0 },
        { id: 'missing-middle', orderTs: null, fallbackRank: 1 },
        { id: 'newest-but-fallback-last', orderTs: 300, fallbackRank: 2 },
    ];
    const sorted = stableSort(rows, createOrderTimeDescendingCompare(rows));
    assert.deepEqual(sorted.map((row) => row.id), [
        'fallback-first',
        'missing-middle',
        'newest-but-fallback-last',
    ]);
});
