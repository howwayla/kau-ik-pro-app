# Position Market Value Return Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stock/ETF market value and unrealized return-rate columns to the Positions table, with sorting and persisted sort preferences.

**Architecture:** Keep broker DTOs unchanged and calculate row-level display metrics in the frontend. Reuse the existing display-price resolver, stock quantity convention, formatting helpers, and table-sort utilities so the new columns match the existing Account summary and Positions table behavior.

**Tech Stack:** React 19, TypeScript, Vite, Node test runner, pnpm workspace, vanilla-extract styles.

---

## File Structure

- Create: `src/lib/position-metrics.ts`
  - Responsibility: pure row-level stock/ETF metrics for market value and unrealized return rate.
- Create: `src/lib/position-metrics.test.ts`
  - Responsibility: TDD coverage for stock-only metrics, missing prices, zero cost, and futures/options non-applicability.
- Modify: `src/components/bottom-dock.tsx`
  - Responsibility: add metrics to `PositionDisplayRow`, add sortable `marketValue` and `returnRate` keys, render the two new columns in the approved order.
- Modify: `scripts/run-ui-tests.mjs`
  - Responsibility: include the new `position-metrics.test.ts` file in UI test execution if the script uses an explicit file list.
- No change: backend provider mappings, `/api/v1/portfolio/position_unit`, broker setup wizard, account summary.

## Task 1: Add Position Metrics Helper

**Files:**
- Create: `src/lib/position-metrics.ts`
- Create: `src/lib/position-metrics.test.ts`
- Check: `scripts/run-ui-tests.mjs`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/position-metrics.test.ts`:

```ts
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
```

- [ ] **Step 2: Add the test file to UI test runner if needed**

Open `scripts/run-ui-tests.mjs`. If it contains an explicit array of test files, include the new test:

```js
const testFiles = [
    'src/lib/display-price.test.ts',
    'src/lib/portfolio-summary.test.ts',
    'src/lib/table-sort.test.ts',
    'src/lib/position-metrics.test.ts',
];
```

If the script already discovers all `src/**/*.test.ts` files automatically, make no change.

- [ ] **Step 3: Run the failing test**

Run:

```bash
pnpm exec tsx --test src/lib/position-metrics.test.ts
```

Expected: FAIL because `src/lib/position-metrics.ts` does not exist or does not export `calculatePositionMetrics`.

- [ ] **Step 4: Implement the minimal helper**

Create `src/lib/position-metrics.ts`:

```ts
import type { Position, StockPosition } from './types/portfolio';

const STOCK_SHARE_MULTIPLIER = 1000;

export interface PositionMetrics {
    marketValue?: number;
    unrealizedReturnRate?: number;
    appliesToStock: boolean;
}

export function isStockPosition(position: Position): position is StockPosition {
    return 'yd_quantity' in position;
}

export function calculatePositionMetrics(
    position: Position,
    options: { displayPriceValue?: number },
): PositionMetrics {
    if (!isStockPosition(position)) {
        return {
            appliesToStock: false,
            marketValue: undefined,
            unrealizedReturnRate: undefined,
        };
    }

    const shares = position.quantity * STOCK_SHARE_MULTIPLIER;
    const cost = position.price * shares;
    const displayPrice = options.displayPriceValue;

    return {
        appliesToStock: true,
        marketValue:
            displayPrice !== undefined && Number.isFinite(displayPrice)
                ? displayPrice * shares
                : undefined,
        unrealizedReturnRate:
            cost > 0 && Number.isFinite(position.pnl)
                ? (position.pnl / cost) * 100
                : undefined,
    };
}
```

- [ ] **Step 5: Run the helper tests**

Run:

```bash
pnpm exec tsx --test src/lib/position-metrics.test.ts
```

Expected: PASS, 4 tests passing.

- [ ] **Step 6: Commit helper**

Run:

```bash
git add src/lib/position-metrics.ts src/lib/position-metrics.test.ts scripts/run-ui-tests.mjs
git diff --cached --name-only
git commit -m "feat: calculate position market metrics"
```

Expected staged files: the metrics helper, its test, and `scripts/run-ui-tests.mjs` only if it needed an explicit test list update.

## Task 2: Wire Metrics Into Position Rows And Sorting

**Files:**
- Modify: `src/components/bottom-dock.tsx`
- Test: `src/lib/position-metrics.test.ts`
- Test: `src/lib/table-sort.test.ts`

- [ ] **Step 1: Write sorting tests for the generic behavior**

Append to `src/lib/table-sort.test.ts`:

```ts
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
```

- [ ] **Step 2: Run sorting tests**

Run:

```bash
pnpm exec tsx --test src/lib/table-sort.test.ts
```

Expected: PASS. These tests document the generic sorting behavior the component will use.

- [ ] **Step 3: Add metrics import and sort keys**

In `src/components/bottom-dock.tsx`, add the import:

```ts
import { calculatePositionMetrics } from '../lib/position-metrics';
```

Change `POSITION_SORT_KEYS` to:

```ts
const POSITION_SORT_KEYS = [
    'symbol',
    'direction',
    'quantity',
    'cost',
    'currentPrice',
    'marketValue',
    'pnl',
    'returnRate',
] as const;
```

Change `POSITION_SORT_DEFAULT_DIRECTIONS` to:

```ts
const POSITION_SORT_DEFAULT_DIRECTIONS: Record<
    PositionSortKey,
    SortDirection
> = {
    symbol: 'asc',
    direction: 'asc',
    quantity: 'desc',
    cost: 'desc',
    currentPrice: 'desc',
    marketValue: 'desc',
    pnl: 'desc',
    returnRate: 'desc',
};
```

- [ ] **Step 4: Add metrics to `PositionDisplayRow` and row construction**

Change the interface:

```ts
interface PositionDisplayRow {
    position: Position;
    contract?: ContractInfo;
    displayPrice: ReturnType<typeof resolveDisplayPrice>;
    metrics: ReturnType<typeof calculatePositionMetrics>;
}
```

In the `positions.map` inside `PositionsTable`, replace the inline return with:

```ts
const displayPrice = resolveDisplayPrice({
    tickClose:
        quote?.tick?.close === undefined
            ? undefined
            : Number(quote.tick.close),
    snapshotClose: snapshot?.close,
    brokerLastPrice: position.last_price,
    reference: contract?.reference,
    previousClose: contract?.previous_close,
});

return {
    position,
    contract,
    displayPrice,
    metrics: calculatePositionMetrics(position, {
        displayPriceValue: displayPrice.value,
    }),
};
```

- [ ] **Step 5: Extend `comparePositionRows`**

In `comparePositionRows`, after the `currentPrice` block and before the final `pnl` return, add:

```ts
if (sort.key === 'marketValue') {
    return compareNullable(
        a.metrics.marketValue,
        b.metrics.marketValue,
        direction,
    );
}

if (sort.key === 'pnl') {
    return compareNullable(a.position.pnl, b.position.pnl, direction);
}

return compareNullable(
    a.metrics.unrealizedReturnRate,
    b.metrics.unrealizedReturnRate,
    direction,
);
```

Remove the old final line:

```ts
return compareNullable(a.position.pnl, b.position.pnl, direction);
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
CI=true pnpm test:ui
```

Expected: PASS, including the new metrics tests and expanded table-sort tests.

- [ ] **Step 7: Commit sorting integration**

Run:

```bash
git add src/components/bottom-dock.tsx src/lib/table-sort.test.ts
git diff --cached --name-only
git commit -m "feat: sort positions by market metrics"
```

Expected staged files: `src/components/bottom-dock.tsx` and `src/lib/table-sort.test.ts`.

## Task 3: Render Market Value And Return Rate Columns

**Files:**
- Modify: `src/components/bottom-dock.tsx`

- [ ] **Step 1: Add percent formatter import**

In `src/components/bottom-dock.tsx`, extend the existing format import:

```ts
import {
    fmtInt,
    fmtMoney,
    fmtPct,
    fmtPrice,
    fmtSigned,
} from '../lib/utils/format';
```

- [ ] **Step 2: Add helper functions near `fmtOrderTime`**

Add:

```ts
function metricCellTitle(row: PositionDisplayRow): string | undefined {
    return row.metrics.appliesToStock ? undefined : '僅股票/ETF 適用';
}

function returnRateDirection(
    value: number | undefined,
): 'up' | 'down' | 'flat' {
    if (value === undefined || value === 0) return 'flat';
    return value > 0 ? 'up' : 'down';
}
```

- [ ] **Step 3: Add sortable headers in approved order**

In the positions table `<thead>`, change the header order to:

```tsx
{sortableHeader('symbol', '商品')}
{sortableHeader('direction', '方向')}
{sortableHeader('quantity', '數量')}
{sortableHeader('cost', '成本')}
{sortableHeader('currentPrice', '現價')}
{sortableHeader('marketValue', '市值')}
{sortableHeader('pnl', '損益')}
{sortableHeader('returnRate', '報酬率')}
<th
    scope='col'
    className={styles.th}
    style={{ width: '18%' }}
>
    損益分布
</th>
<th scope='col' className={styles.th} />
```

- [ ] **Step 4: Add body cells in the matching order**

In each positions table row, after the existing `現價` `<td>` and before the `損益` `<td>`, add:

```tsx
<td className={`${styles.td} ${SENSITIVE}`} title={metricCellTitle(row)}>
    {fmtMoney(row.metrics.marketValue)}
</td>
```

After the existing `損益` `<td>` and before the `損益分布` `<td>`, add:

```tsx
<td
    className={`${styles.td} ${
        panel.dirText[returnRateDirection(row.metrics.unrealizedReturnRate)]
    } ${SENSITIVE}`}
    title={metricCellTitle(row)}
>
    {fmtPct(row.metrics.unrealizedReturnRate)}
</td>
```

- [ ] **Step 5: Run build-level verification**

Run:

```bash
CI=true pnpm build
```

Expected: PASS. This catches TypeScript errors in the component changes.

- [ ] **Step 6: Commit rendering**

Run:

```bash
git add src/components/bottom-dock.tsx
git diff --cached --name-only
git commit -m "feat: show position market value and return"
```

Expected staged file: `src/components/bottom-dock.tsx`.

## Task 4: Full Verification And Cleanup

**Files:**
- Check: all changed files

- [ ] **Step 1: Run full test suite**

Run:

```bash
CI=true pnpm test
```

Expected: PASS.

- [ ] **Step 2: Run production build**

Run:

```bash
CI=true pnpm build
```

Expected: PASS.

- [ ] **Step 3: Inspect git status**

Run:

```bash
git status --branch --short
```

Expected:

```text
## codex/new-product-feature
?? .npmrc
?? .pnpm-store/
?? .superpowers/
?? log/
```

It is acceptable for those local untracked entries to remain. Do not stage them.

- [ ] **Step 4: Review final diff**

Run:

```bash
git log --oneline --decorate -5
git diff codex/integrate-broker-portfolio...HEAD --stat
```

Expected: commits include the design doc plus the implementation commits. Diff should be limited to docs, frontend helper/tests, UI test runner if needed, and `bottom-dock.tsx`.

- [ ] **Step 5: Final response**

Report:

- New helper and tests added.
- Positions table now shows sortable `市值` and `報酬率`.
- Stock/ETF rows calculate values; futures/options show `—`.
- Verification commands and results.
