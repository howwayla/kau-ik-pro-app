import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    compareNullable,
    createMemorySortStorage,
    loadSortState,
    orderTimeDescendingCompare,
    saveSortState,
    stableSort,
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

test('order time compare uses order_ts when both rows have one', () => {
    const rows = [
        { id: 'old', orderTs: 100, fallbackRank: 1 },
        { id: 'new', orderTs: 200, fallbackRank: 0 },
    ];
    const sorted = stableSort(rows, orderTimeDescendingCompare);
    assert.deepEqual(sorted.map((row) => row.id), ['new', 'old']);
});

test('order time compare falls back to current reversed rank when any order_ts is missing', () => {
    const rows = [
        { id: 'first-original', orderTs: undefined, fallbackRank: 1 },
        { id: 'last-original', orderTs: 200, fallbackRank: 0 },
    ];
    const sorted = stableSort(rows, orderTimeDescendingCompare);
    assert.deepEqual(sorted.map((row) => row.id), ['last-original', 'first-original']);
});
