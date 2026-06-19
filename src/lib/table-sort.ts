export type SortDirection = 'asc' | 'desc';

export interface SortState<Key extends string> {
    key: Key;
    direction: SortDirection;
}

export interface SortStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export function stableSort<T>(rows: readonly T[], compare: (a: T, b: T) => number): T[] {
    return rows
        .map((row, index) => ({ row, index }))
        .sort((a, b) => {
            const result = compare(a.row, b.row);
            return result === 0 ? a.index - b.index : result;
        })
        .map((entry) => entry.row);
}

export function compareNullable(
    a: number | string | undefined,
    b: number | string | undefined,
    direction: SortDirection,
): number {
    if (a === undefined && b === undefined) return 0;
    if (a === undefined) return 1;
    if (b === undefined) return -1;
    const result =
        typeof a === 'number' && typeof b === 'number'
            ? a - b
            : String(a).localeCompare(String(b), 'zh-Hant');
    return direction === 'asc' ? result : -result;
}

export function toggleSort<Key extends string>(
    current: SortState<Key> | null,
    key: Key,
    defaultDirection: SortDirection = 'asc',
): SortState<Key> {
    if (current?.key !== key) return { key, direction: defaultDirection };
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}

export function loadSortState<Key extends string>(
    storage: SortStorage,
    storageKey: string,
    allowedKeys: readonly Key[],
): SortState<Key> | null {
    try {
        const raw = storage.getItem(storageKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<SortState<Key>>;
        if (
            allowedKeys.includes(parsed.key as Key) &&
            (parsed.direction === 'asc' || parsed.direction === 'desc')
        ) {
            return { key: parsed.key as Key, direction: parsed.direction };
        }
    } catch {
        return null;
    }
    return null;
}

export function saveSortState<Key extends string>(
    storage: SortStorage,
    storageKey: string,
    state: SortState<Key>,
): void {
    storage.setItem(storageKey, JSON.stringify(state));
}

export function createMemorySortStorage(): SortStorage & {
    data: Map<string, string>;
} {
    const data = new Map<string, string>();
    return {
        data,
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => {
            data.set(key, value);
        },
    };
}

export interface OrderTimeSortable {
    orderTs?: number;
    fallbackRank: number;
}

export function orderTimeDescendingCompare(
    a: OrderTimeSortable,
    b: OrderTimeSortable,
): number {
    if (a.orderTs !== undefined && b.orderTs !== undefined) {
        return b.orderTs - a.orderTs;
    }
    return a.fallbackRank - b.fallbackRank;
}
