# Portfolio Tables Symbol, Sort, And Price Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the PR3 portfolio table improvements: shared symbol display, sortable positions/orders tables, price source labeling, and account summary calculations that do not collapse when broker `last_price` is `0`.

**Architecture:** Extract pure table/price logic into small tested utilities, then wire them into existing React components with minimal UI reshaping. Use `ensureContract` for contract/name resolution and quote subscription, `fetchSnapshots` for batch fallback prices, and stable localStorage-backed sort state for each table.

**Tech Stack:** React 19, TypeScript, vanilla-extract CSS, Vite, Node built-in test runner via `tsx --test`, existing REST/SSE clients in `src/lib/backend.ts` and `src/lib/stream.ts`.

---

## File Structure

- Modify `package.json`: add a root `test:ui` script and root `tsx` dev dependency so frontend pure TypeScript logic can be tested without adding Vitest.
- Create `src/lib/display-price.ts`: pure resolver for displayed price value, source label, tooltip, and numeric value used by sorting/account calculations.
- Create `src/lib/display-price.test.ts`: Node tests for live/snapshot/broker/reference/missing priority and `last_price = 0`.
- Create `src/lib/table-sort.ts`: pure stable sort helpers, localStorage sort persistence helpers, and order-time fallback comparator.
- Create `src/lib/table-sort.test.ts`: Node tests for stable sorting, missing values, saved state validation, and order time fallback preserving current reversed order.
- Create `src/lib/portfolio-summary.ts`: pure account summary helper that uses resolved display prices and counts missing-price positions.
- Create `src/lib/portfolio-summary.test.ts`: Node tests proving snapshot/reference fallback values are included in market value and only true missing prices are excluded.
- Create `src/components/symbol-cell.css.ts`: shared symbol cell layout and marker styles copied/adapted from watchlist styles.
- Create `src/components/symbol-cell.tsx`: `SymbolCell` and `ResolvedSymbolCell` shared by watchlist, positions, and orders.
- Modify `src/components/watchlist.tsx`: replace inline code/name/badge markup with `SymbolCell` while preserving row layout, regulatory flags, and trial marker.
- Modify `src/components/watchlist.css.ts`: remove or stop using symbol-specific styles after they move to `symbol-cell.css.ts`; keep row, price, change, add controls.
- Create `src/hooks/use-position-market-data.ts`: resolve visible position contracts, trigger `ensureContract` side effects, batch `fetchSnapshots`, expose contracts/snapshots/loading metadata.
- Create `src/hooks/use-quotes.ts`: subscribe to multiple quote codes in one hook for account calculations without calling `useQuote` in a loop.
- Modify `src/components/bottom-dock.css.ts`: add sortable header button styles, sort arrow, symbol cell alignment, and price source badge styles.
- Modify `src/components/bottom-dock.tsx`: wire symbol cells, sortable headers, display price resolver, positions/order sorting, and account calculations.

## Task 1: Frontend Logic Test Harness

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the root UI test command**

Modify the root scripts and devDependencies like this:

```json
{
  "scripts": {
    "dev": "vite",
    "dev:server": "pnpm --filter kau-ik-pro-server dev",
    "dev:all": "concurrently -k \"pnpm dev\" \"pnpm dev:server\"",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "desktop:build": "node scripts/build-desktop.mjs",
    "desktop:dev": "node scripts/build-desktop.mjs --dev",
    "desktop:doctor": "node scripts/build-desktop.mjs --doctor",
    "test": "node --test scripts/desktop-targets.test.mjs scripts/preflight.test.mjs && pnpm test:ui -- src/lib/*.test.ts",
    "test:ui": "tsx --test"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.11.2",
    "@types/node": "^25.9.2",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vanilla-extract/vite-plugin": "^5.2.2",
    "@vitejs/plugin-react": "^6.0.1",
    "concurrently": "^9.1.0",
    "tsx": "^4.19.0",
    "typescript": "~5.9.3",
    "vite": "^8.0.1"
  }
}
```

- [ ] **Step 2: Refresh the lockfile**

Run:

```bash
pnpm install
```

Expected: `pnpm-lock.yaml` updates if needed, and no npm lockfile is created.

- [ ] **Step 3: Verify the new UI test runner is available**

Run:

```bash
pnpm exec tsx --version
```

Expected: prints the installed `tsx` version.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "test: add frontend logic test harness"
```

## Task 2: Display Price Resolver

**Files:**
- Create: `src/lib/display-price.ts`
- Create: `src/lib/display-price.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/display-price.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm test:ui -- src/lib/display-price.test.ts
```

Expected: FAIL with an import error for `./display-price` or missing `resolveDisplayPrice`.

- [ ] **Step 3: Implement the resolver**

Create `src/lib/display-price.ts`:

```ts
export type DisplayPriceSource =
    | 'live'
    | 'close'
    | 'broker'
    | 'reference'
    | 'missing';

export interface DisplayPrice {
    value?: number;
    source: DisplayPriceSource;
    label: '即時' | '收盤' | '券商' | '參考' | '無資料';
    title: string;
}

export interface ResolveDisplayPriceInput {
    tickClose?: number;
    snapshotClose?: number;
    brokerLastPrice?: number;
    reference?: number;
    previousClose?: number;
}

function positive(value: number | undefined): number | undefined {
    return Number.isFinite(value) && value !== undefined && value > 0
        ? value
        : undefined;
}

export function resolveDisplayPrice(input: ResolveDisplayPriceInput): DisplayPrice {
    const live = positive(input.tickClose);
    if (live !== undefined) {
        return { value: live, source: 'live', label: '即時', title: '即時成交價' };
    }

    const close = positive(input.snapshotClose);
    if (close !== undefined) {
        return {
            value: close,
            source: 'close',
            label: '收盤',
            title: '最近收盤價',
        };
    }

    const broker = positive(input.brokerLastPrice);
    if (broker !== undefined) {
        return {
            value: broker,
            source: 'broker',
            label: '券商',
            title: '券商回報價格',
        };
    }

    const reference = positive(input.reference) ?? positive(input.previousClose);
    if (reference !== undefined) {
        return {
            value: reference,
            source: 'reference',
            label: '參考',
            title: '參考價',
        };
    }

    return {
        value: undefined,
        source: 'missing',
        label: '無資料',
        title: '沒有可用價格',
    };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm test:ui -- src/lib/display-price.test.ts
```

Expected: PASS for all `display-price` tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/display-price.ts src/lib/display-price.test.ts
git commit -m "feat: add display price resolver"
```

## Task 3: Stable Sorting And Sort Persistence

**Files:**
- Create: `src/lib/table-sort.ts`
- Create: `src/lib/table-sort.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/table-sort.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm test:ui -- src/lib/table-sort.test.ts
```

Expected: FAIL with an import error for `./table-sort` or missing exports.

- [ ] **Step 3: Implement the sorting helpers**

Create `src/lib/table-sort.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm test:ui -- src/lib/table-sort.test.ts
```

Expected: PASS for all `table-sort` tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/table-sort.ts src/lib/table-sort.test.ts
git commit -m "feat: add portfolio table sorting helpers"
```

## Task 4: Account Summary Price Math

**Files:**
- Create: `src/lib/portfolio-summary.ts`
- Create: `src/lib/portfolio-summary.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/portfolio-summary.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeStockPositions } from './portfolio-summary';
import type { DisplayPrice } from './display-price';

const price = (value: number | undefined, source: DisplayPrice['source']): DisplayPrice => ({
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm test:ui -- src/lib/portfolio-summary.test.ts
```

Expected: FAIL with an import error for `./portfolio-summary` or missing `summarizeStockPositions`.

- [ ] **Step 3: Implement account summary math**

Create `src/lib/portfolio-summary.ts`:

```ts
import type { DisplayPrice } from './display-price';

export interface StockPositionSummaryInput {
    code: string;
    quantity: number;
    averagePrice: number;
    pnl: number;
    reference?: number;
    displayPrice: DisplayPrice;
}

export interface StockPositionSummary {
    totalPnl: number;
    totalCost: number;
    totalMarketValue: number;
    todayUnrealized: number;
    missingPriceCount: number;
}

export function summarizeStockPositions(
    positions: readonly StockPositionSummaryInput[],
): StockPositionSummary {
    return positions.reduce<StockPositionSummary>(
        (summary, position) => {
            summary.totalPnl += position.pnl;
            summary.totalCost += position.averagePrice * position.quantity * 1000;

            const current = position.displayPrice.value;
            if (current === undefined) {
                summary.missingPriceCount += 1;
                return summary;
            }

            summary.totalMarketValue += current * position.quantity * 1000;
            if (position.reference !== undefined && position.reference > 0) {
                summary.todayUnrealized +=
                    (current - position.reference) * position.quantity * 1000;
            }
            return summary;
        },
        {
            totalPnl: 0,
            totalCost: 0,
            totalMarketValue: 0,
            todayUnrealized: 0,
            missingPriceCount: 0,
        },
    );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm test:ui -- src/lib/portfolio-summary.test.ts
```

Expected: PASS for all `portfolio-summary` tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portfolio-summary.ts src/lib/portfolio-summary.test.ts
git commit -m "feat: summarize portfolio values from display prices"
```

## Task 5: Shared SymbolCell

**Files:**
- Create: `src/components/symbol-cell.css.ts`
- Create: `src/components/symbol-cell.tsx`
- Modify: `src/components/watchlist.tsx`
- Modify: `src/components/watchlist.css.ts`

- [ ] **Step 1: Create shared SymbolCell styles**

Create `src/components/symbol-cell.css.ts`:

```ts
import { style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const root = style({
    display: 'grid',
    gap: '1px',
    minWidth: 0,
});

export const codeLine = style({
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    minWidth: 0,
});

export const code = style({
    fontFamily: vars.font.mono,
    fontSize: '0.8rem',
    fontWeight: 600,
    color: vars.color.foreground,
});

export const name = style({
    fontSize: '0.68rem',
    color: vars.color.mutedForeground,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

const badgeBase = style({
    fontFamily: vars.font.display,
    fontSize: '0.56rem',
    fontWeight: 600,
    borderRadius: vars.radius.sm,
    padding: '0 3px',
    lineHeight: 1.25,
});

export const badge = styleVariants({
    trial: [
        badgeBase,
        { color: vars.color.amber, border: `1px solid ${vars.color.amber}` },
    ],
    punish: [badgeBase, { color: '#ff5d5d', border: '1px solid #ff5d5d' }],
    attention: [
        badgeBase,
        { color: vars.color.amber, border: `1px solid ${vars.color.amber}` },
    ],
});
```

- [ ] **Step 2: Create SymbolCell components**

Create `src/components/symbol-cell.tsx`:

```tsx
import { useEffect } from 'react';
import { ensureContract, useContract } from '../lib/contracts-cache';
import { useRegulatoryFlag } from '../lib/regulatory';
import type { SecurityType } from '../lib/types/contract';
import * as styles from './symbol-cell.css';

export type SymbolMarker = 'trial' | 'punish' | 'attention';

export function SymbolCell({
    code,
    name,
    markers = [],
}: {
    code: string;
    name?: string;
    markers?: SymbolMarker[];
}) {
    return (
        <span className={styles.root}>
            <span className={styles.codeLine}>
                <span className={styles.code}>{code}</span>
                {markers.map((marker) => (
                    <span key={marker} className={styles.badge[marker]} title={markerLabel(marker)}>
                        {markerText(marker)}
                    </span>
                ))}
            </span>
            {name && <span className={styles.name}>{name}</span>}
        </span>
    );
}

export function ResolvedSymbolCell({
    code,
    type,
    fallbackName,
}: {
    code: string;
    type?: SecurityType;
    fallbackName?: string;
}) {
    const contract = useContract(code);
    const regFlag = useRegulatoryFlag(code);
    useEffect(() => {
        if (!code || contract) return;
        ensureContract(code, type).catch(() => undefined);
    }, [code, contract, type]);
    return (
        <SymbolCell
            code={code}
            name={contract?.name ?? fallbackName}
            markers={regFlag ? [regFlag] : []}
        />
    );
}

function markerLabel(marker: SymbolMarker): string {
    if (marker === 'trial') return '試算撮合';
    if (marker === 'punish') return '處置股';
    return '注意股';
}

function markerText(marker: SymbolMarker): string {
    if (marker === 'trial') return '試';
    if (marker === 'punish') return '處';
    return '注';
}
```

- [ ] **Step 3: Refactor WatchRow to use SymbolCell**

In `src/components/watchlist.tsx`, import `SymbolCell`:

```tsx
import { SymbolCell, type SymbolMarker } from './symbol-cell';
```

Replace the code/name/badge spans inside `WatchRow` with:

```tsx
const markers: SymbolMarker[] = [
    ...(regFlag ? [regFlag] : []),
    ...(tick?.simtrade ? ['trial' as const] : []),
];
```

and in JSX:

```tsx
<SymbolCell
    code={item.contract.code}
    name={item.contract.name}
    markers={markers}
/>
```

Keep the price, change, and remove button JSX unchanged.

- [ ] **Step 4: Remove unused watchlist symbol styles**

In `src/components/watchlist.css.ts`, remove the `code`, `name`, and `rowBadge` exports after confirming TypeScript reports them unused.

- [ ] **Step 5: Verify build**

Run:

```bash
pnpm build
```

Expected: TypeScript and Vite build both pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/symbol-cell.css.ts src/components/symbol-cell.tsx src/components/watchlist.tsx src/components/watchlist.css.ts
git commit -m "feat: share symbol cell display"
```

## Task 6: Position Market Data Hooks

**Files:**
- Create: `src/hooks/use-position-market-data.ts`
- Create: `src/hooks/use-quotes.ts`

- [ ] **Step 1: Create multi-quote hook**

Create `src/hooks/use-quotes.ts`:

```ts
import { useEffect, useMemo, useState } from 'react';
import {
    ensureStream,
    getQuote,
    subscribeQuoteStore,
    type QuoteState,
} from '../lib/stream';

export function useQuotes(codes: readonly string[]): Record<string, QuoteState | undefined> {
    const key = useMemo(() => [...new Set(codes)].sort().join(','), [codes]);
    const uniqueCodes = useMemo(
        () => key.split(',').filter(Boolean),
        [key],
    );
    const [version, setVersion] = useState(0);
    useEffect(ensureStream, []);
    useEffect(() => {
        const listener = () => setVersion((current) => current + 1);
        const unsubscribers = uniqueCodes.map((code) =>
            subscribeQuoteStore(code, listener),
        );
        return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    }, [key, uniqueCodes]);
    return useMemo(
        () =>
            Object.fromEntries(
                uniqueCodes.map((code) => [code, getQuote(code)]),
            ),
        [uniqueCodes, version],
    );
}
```

- [ ] **Step 2: Create position market data hook**

Create `src/hooks/use-position-market-data.ts`:

```ts
import { useEffect, useMemo, useState } from 'react';
import { fetchSnapshots } from '../lib/backend';
import { ensureContract } from '../lib/contracts-cache';
import type { ContractInfo } from '../lib/types/contract';
import type { Snapshot } from '../lib/types/market';
import type { Position } from '../lib/types/portfolio';

interface PositionMarketData {
    contracts: Record<string, ContractInfo | undefined>;
    snapshots: Record<string, Snapshot | undefined>;
}

export function usePositionMarketData(positions: readonly Position[]): PositionMarketData {
    const codesKey = useMemo(
        () => [...new Set(positions.map((position) => position.code))].sort().join(','),
        [positions],
    );
    const codes = useMemo(() => codesKey.split(',').filter(Boolean), [codesKey]);
    const [contracts, setContracts] = useState<Record<string, ContractInfo | undefined>>({});
    const [snapshots, setSnapshots] = useState<Record<string, Snapshot | undefined>>({});

    useEffect(() => {
        let alive = true;
        if (codes.length === 0) {
            setContracts({});
            setSnapshots({});
            return () => {
                alive = false;
            };
        }

        Promise.allSettled(codes.map((code) => ensureContract(code))).then((results) => {
            if (!alive) return;
            const nextContracts: Record<string, ContractInfo | undefined> = {};
            for (const result of results) {
                if (result.status === 'fulfilled') {
                    nextContracts[result.value.code] = result.value;
                }
            }
            setContracts(nextContracts);
            const resolved = Object.values(nextContracts).filter(
                (contract): contract is ContractInfo => Boolean(contract),
            );
            if (resolved.length === 0) {
                setSnapshots({});
                return;
            }
            fetchSnapshots(resolved)
                .then((rows) => {
                    if (!alive) return;
                    setSnapshots(
                        Object.fromEntries(rows.map((row) => [row.code, row])),
                    );
                })
                .catch(() => {
                    if (alive) setSnapshots({});
                });
        });

        return () => {
            alive = false;
        };
    }, [codesKey]);

    return { contracts, snapshots };
}
```

- [ ] **Step 3: Verify build**

Run:

```bash
pnpm build
```

Expected: TypeScript and Vite build both pass.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-position-market-data.ts src/hooks/use-quotes.ts
git commit -m "feat: resolve position market data"
```

## Task 7: Positions Table Integration

**Files:**
- Modify: `src/components/bottom-dock.css.ts`
- Modify: `src/components/bottom-dock.tsx`

- [ ] **Step 1: Add sortable header and price badge styles**

In `src/components/bottom-dock.css.ts`, add:

```ts
export const sortableHeader = style({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '4px',
    width: '100%',
    border: 0,
    padding: 0,
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer',
    selectors: {
        '&:hover': { color: vars.color.foreground },
    },
});

export const sortArrow = style({
    width: '0.75rem',
    textAlign: 'center',
    color: vars.color.accent,
});

export const priceWithSource = style({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '6px',
});

export const sourceBadge = style({
    fontFamily: vars.font.display,
    fontSize: '0.56rem',
    fontWeight: 600,
    color: vars.color.mutedForeground,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    padding: '0 4px',
});
```

- [ ] **Step 2: Add table sort imports and constants**

In `src/components/bottom-dock.tsx`, add imports:

```tsx
import { usePositionMarketData } from '../hooks/use-position-market-data';
import { useQuotes } from '../hooks/use-quotes';
import { resolveDisplayPrice, type DisplayPrice } from '../lib/display-price';
import {
    compareNullable,
    loadSortState,
    saveSortState,
    stableSort,
    toggleSort,
    type SortState,
} from '../lib/table-sort';
import { ResolvedSymbolCell } from './symbol-cell';
```

Add near the top of the file:

```ts
type PositionSortKey = 'symbol' | 'direction' | 'quantity' | 'cost' | 'last' | 'pnl';

const POSITION_SORT_STORAGE_KEY = 'kau-ik-pro-positions-sort';
const POSITION_SORT_KEYS: readonly PositionSortKey[] = [
    'symbol',
    'direction',
    'quantity',
    'cost',
    'last',
    'pnl',
];
```

- [ ] **Step 3: Add `SortableHeader` and `PriceWithSource` helpers**

Add helper components inside `bottom-dock.tsx` before `PositionsTable`:

```tsx
function SortableHeader<Key extends string>({
    label,
    sortKey,
    state,
    onSort,
}: {
    label: string;
    sortKey: Key;
    state: SortState<Key> | null;
    onSort: (key: Key) => void;
}) {
    const active = state?.key === sortKey;
    const arrow = !active ? '↕' : state.direction === 'asc' ? '↑' : '↓';
    return (
        <button className={styles.sortableHeader} onClick={() => onSort(sortKey)}>
            <span>{label}</span>
            <span className={styles.sortArrow}>{arrow}</span>
        </button>
    );
}

function PriceWithSource({ price }: { price: DisplayPrice }) {
    return (
        <span className={styles.priceWithSource} title={price.title}>
            <span>{fmtPrice(price.value)}</span>
            <span className={styles.sourceBadge}>{price.label}</span>
        </span>
    );
}
```

- [ ] **Step 4: Split `PositionRow` so display rendering is isolated per row**

Add:

```tsx
function PositionRow({
    position,
    maxAbsPnl,
    busyCode,
    onAct,
    displayPrice,
}: {
    position: Position;
    maxAbsPnl: number;
    busyCode: string | null;
    onAct: (position: Position, mode: 'close' | 'reverse') => void;
    displayPrice: DisplayPrice;
}) {
    const dir =
        position.pnl > 0 ? 'up' : position.pnl < 0 ? 'down' : 'flat';
    return (
        <tr key={`${position.code}-${position.id}`}>
            <td className={styles.td}>
                <ResolvedSymbolCell code={position.code} />
            </td>
            <td
                className={`${styles.td} ${panel.dirText[position.direction === 'Buy' ? 'up' : 'down']}`}
            >
                {position.direction === 'Buy' ? '多 LONG' : '空 SHORT'}
            </td>
            <td className={`${styles.td} ${SENSITIVE}`}>{fmtInt(position.quantity)}</td>
            <td className={`${styles.td} ${SENSITIVE}`}>{fmtPrice(position.price)}</td>
            <td className={styles.td}>
                <PriceWithSource price={displayPrice} />
            </td>
            <td className={`${styles.td} ${panel.dirText[dir]} ${SENSITIVE}`}>
                {fmtSigned(position.pnl, 0)}
            </td>
            <td className={styles.td}>
                <div className={styles.pnlBar}>
                    <div
                        className={styles.pnlFill}
                        style={{
                            left: position.pnl >= 0 ? '50%' : undefined,
                            right: position.pnl < 0 ? '50%' : undefined,
                            width: `${(Math.abs(position.pnl) / maxAbsPnl) * 50}%`,
                            background:
                                position.pnl >= 0 ? vars.color.up : vars.color.down,
                        }}
                    />
                </div>
            </td>
            <td className={styles.td}>
                <button
                    className={styles.cancelBtn}
                    disabled={busyCode === position.code}
                    title="市價沖銷此倉位"
                    onClick={() => onAct(position, 'close')}
                >
                    平
                </button>{' '}
                <button
                    className={styles.cancelBtn}
                    disabled={busyCode === position.code}
                    title="市價反向兩倍（翻倉）"
                    onClick={() => onAct(position, 'reverse')}
                >
                    反
                </button>
            </td>
        </tr>
    );
}
```

- [ ] **Step 5: Wire positions sorting and display prices**

Inside `PositionsTable`, add state initialization:

```tsx
const [sort, setSort] = useState<SortState<PositionSortKey> | null>(() =>
    loadSortState(window.localStorage, POSITION_SORT_STORAGE_KEY, POSITION_SORT_KEYS),
);
const { contracts, snapshots } = usePositionMarketData(positions);
const quotes = useQuotes(positions.map((position) => position.code));
```

Use this setter:

```tsx
const onSort = (key: PositionSortKey) => {
    setSort((current) => {
        const next = toggleSort(current, key, key === 'pnl' ? 'desc' : 'asc');
        saveSortState(window.localStorage, POSITION_SORT_STORAGE_KEY, next);
        return next;
    });
};
```

Build sorted rows with `stableSort`; `last` uses `DisplayPrice.value`:

```tsx
const rows = positions.map((position) => {
    const contract = contracts[position.code];
    const quote = quotes[position.code];
    const displayPrice = resolveDisplayPrice({
        tickClose: quote?.tick ? Number(quote.tick.close) : undefined,
        snapshotClose: snapshots[position.code]?.close,
        brokerLastPrice: position.last_price,
        reference: contract?.reference,
        previousClose: contract?.previous_close,
    });
    return { position, contract, displayPrice };
});

const sortedRows = sort
    ? stableSort(rows, (a, b) => {
          if (sort.key === 'symbol') {
              return compareNullable(a.position.code, b.position.code, sort.direction);
          }
          if (sort.key === 'direction') {
              return compareNullable(
                  a.position.direction,
                  b.position.direction,
                  sort.direction,
              );
          }
          if (sort.key === 'quantity') {
              return compareNullable(
                  a.position.quantity,
                  b.position.quantity,
                  sort.direction,
              );
          }
          if (sort.key === 'cost') {
              return compareNullable(a.position.price, b.position.price, sort.direction);
          }
          if (sort.key === 'last') {
              return compareNullable(
                  a.displayPrice.value,
                  b.displayPrice.value,
                  sort.direction,
              );
          }
          return compareNullable(a.position.pnl, b.position.pnl, sort.direction);
      })
    : rows;
```

Replace sortable table headers with `SortableHeader`; leave distribution/actions unsortable.

- [ ] **Step 6: Verify build and UI behavior**

Run:

```bash
pnpm build
```

Expected: TypeScript and Vite build both pass.

Run the app in browser or desktop dev mode and check:

```bash
pnpm dev:all
```

Expected: positions table shows code/name, sortable headers, and price source badges. If the command is run in Codex and stays active, stop it after visual verification.

- [ ] **Step 7: Commit**

```bash
git add src/components/bottom-dock.tsx src/components/bottom-dock.css.ts
git commit -m "feat: add sortable position prices"
```

## Task 8: Orders Table Integration

**Files:**
- Modify: `src/components/bottom-dock.tsx`

- [ ] **Step 1: Add order sort constants**

Add near the position sort constants:

```ts
type OrderSortKey = 'symbol' | 'action' | 'price' | 'quantity' | 'status' | 'time';

const ORDER_SORT_STORAGE_KEY = 'kau-ik-pro-orders-sort';
const ORDER_SORT_KEYS: readonly OrderSortKey[] = [
    'symbol',
    'action',
    'price',
    'quantity',
    'status',
    'time',
];
```

- [ ] **Step 2: Add order sorting state**

Inside `OrdersTable`, add:

```tsx
const [sort, setSort] = useState<SortState<OrderSortKey> | null>(() =>
    loadSortState(window.localStorage, ORDER_SORT_STORAGE_KEY, ORDER_SORT_KEYS) ?? {
        key: 'time',
        direction: 'desc',
    },
);
const onSort = (key: OrderSortKey) => {
    setSort((current) => {
        const next = toggleSort(current, key, key === 'time' ? 'desc' : 'asc');
        saveSortState(window.localStorage, ORDER_SORT_STORAGE_KEY, next);
        return next;
    });
};
```

- [ ] **Step 3: Replace reverse-only rendering with sort rows**

Before JSX return in `OrdersTable`, build rows:

```tsx
const orderRows = trades.map((trade, originalIndex) => ({
    trade,
    fallbackRank: trades.length - 1 - originalIndex,
    effectivePrice: trade.status.modified_price || trade.order.price,
    orderTs: trade.status.order_ts,
}));

const sortedRows = stableSort(orderRows, (a, b) => {
    if (sort.key === 'time') {
        return sort.direction === 'desc'
            ? orderTimeDescendingCompare(a, b)
            : -orderTimeDescendingCompare(a, b);
    }
    if (sort.key === 'symbol') {
        return compareNullable(a.trade.contract.code, b.trade.contract.code, sort.direction);
    }
    if (sort.key === 'action') {
        return compareNullable(a.trade.order.action, b.trade.order.action, sort.direction);
    }
    if (sort.key === 'price') {
        return compareNullable(a.effectivePrice, b.effectivePrice, sort.direction);
    }
    if (sort.key === 'quantity') {
        return compareNullable(a.trade.order.quantity, b.trade.order.quantity, sort.direction);
    }
    return compareNullable(a.trade.status.status, b.trade.status.status, sort.direction);
});
```

Import `orderTimeDescendingCompare` from `src/lib/table-sort.ts`.

- [ ] **Step 4: Replace order headers and symbol cell**

Use `SortableHeader` for sortable columns. Keep 成交量, 訊息, 操作 unsortable.

Replace the first order cell with:

```tsx
<td className={styles.td}>
    <ResolvedSymbolCell
        code={t.contract.code}
        type={t.contract.security_type}
        fallbackName={t.contract.name}
    />
</td>
```

Render rows from `sortedRows.map(({ trade: t }) => ...)` instead of `[...trades].reverse().map(...)`.

- [ ] **Step 5: Verify build and order fallback behavior**

Run:

```bash
pnpm test:ui -- src/lib/table-sort.test.ts
pnpm build
```

Expected: sorting tests pass and build passes. In mock mode, orders without `order_ts` preserve the existing reversed fallback order.

- [ ] **Step 6: Commit**

```bash
git add src/components/bottom-dock.tsx
git commit -m "feat: add sortable order table"
```

## Task 9: Account Summary Integration

**Files:**
- Modify: `src/components/bottom-dock.tsx`

- [ ] **Step 1: Import account summary helper**

In `src/components/bottom-dock.tsx`, add:

```tsx
import { summarizeStockPositions } from '../lib/portfolio-summary';
```

- [ ] **Step 2: Reuse market data in AccountView**

Inside `AccountView`, replace the separate `refs` state/effect with:

```tsx
const { contracts, snapshots } = usePositionMarketData(stockPos);
const quotes = useQuotes(stockPos.map((position) => position.code));
const positionInputs = stockPos.map((position) => {
    const contract = contracts[position.code];
    const quote = quotes[position.code];
    const displayPrice = resolveDisplayPrice({
        tickClose: quote?.tick ? Number(quote.tick.close) : undefined,
        snapshotClose: snapshots[position.code]?.close,
        brokerLastPrice: position.last_price,
        reference: contract?.reference,
        previousClose: contract?.previous_close,
    });
    return {
        code: position.code,
        quantity: position.quantity,
        averagePrice: position.price,
        pnl: position.pnl,
        reference: contract?.reference,
        displayPrice,
    };
});
const summary = summarizeStockPositions(positionInputs);
```

Then replace:

```tsx
const totalPnl = stockPos.reduce((s, p) => s + p.pnl, 0);
const totalCost = stockPos.reduce(
    (s, p) => s + p.price * p.quantity * 1000,
    0,
);
const totalMkt = stockPos.reduce(
    (s, p) => s + (p.last_price > 0 ? p.last_price * p.quantity * 1000 : 0),
    0,
);
const todayUnreal = stockPos.reduce((s, p) => {
    const ref = refs[p.code];
    return ref && p.last_price > 0
        ? s + (p.last_price - ref) * p.quantity * 1000
        : s;
}, 0);
```

with:

```tsx
const totalPnl = summary.totalPnl;
const totalCost = summary.totalCost;
const totalMkt = summary.totalMarketValue;
const todayUnreal = summary.todayUnrealized;
```

- [ ] **Step 3: Add missing-price hint text**

Update the total market value item hint:

```tsx
{
    label: '總市值 Market Value',
    value: fmtMoney(totalMkt),
    hint:
        summary.missingPriceCount > 0
            ? `Σ 現價 × 持股；有 ${summary.missingPriceCount} 筆部位因缺少價格未納入`
            : 'Σ 現價 × 持股',
}
```

- [ ] **Step 4: Verify tests and build**

Run:

```bash
pnpm test:ui -- src/lib/portfolio-summary.test.ts src/lib/display-price.test.ts
pnpm build
```

Expected: tests pass and build passes. The account summary no longer depends on raw broker `last_price` for market value when display-price fallback exists.

- [ ] **Step 5: Commit**

```bash
git add src/components/bottom-dock.tsx
git commit -m "feat: calculate account values from display prices"
```

## Task 10: Final Verification

**Files:**
- Verify only; no planned file edits unless a previous task missed something.

- [ ] **Step 1: Run full tests**

Run:

```bash
pnpm test
```

Expected: existing desktop/preflight tests and new UI logic tests pass.

- [ ] **Step 2: Run production build**

Run:

```bash
pnpm build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 3: Run app smoke check**

Run:

```bash
pnpm dev:all
```

Manual checks:

- Watchlist still shows code, Chinese name, regulatory/trial markers, price, and change.
- Positions shows code and Chinese name in 商品欄.
- Positions 現價 shows price plus source badge.
- Positions sortable columns: 商品、方向、數量、成本、現價、損益.
- Orders shows code and Chinese name in 商品欄.
- Orders sortable columns: 商品、買賣、價格、數量、狀態、時間.
- Orders without `order_ts` keep the existing new-on-top approximation.
- Account market value uses fallback display prices and does not treat broker `last_price = 0` as a valid price.

- [ ] **Step 4: Stop dev processes**

If `pnpm dev:all` is still running in this session, stop it before finishing the task.

- [ ] **Step 5: Commit verification fixes if any**

If verification required small fixes, commit them:

```bash
git add src package.json pnpm-lock.yaml
git commit -m "fix: polish portfolio table integration"
```

If no fixes were needed, do not create an empty commit.
