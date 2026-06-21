// src/components/bottom-dock.tsx — positions / orders / account tabs

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePoll } from '../hooks/use-poll';
import { usePositionMarketData } from '../hooks/use-position-market-data';
import { useQuotes } from '../hooks/use-quotes';
import { apiPost } from '../lib/api';
import { resolveDisplayPrice } from '../lib/display-price';
import {
    formatMissingPriceCountHint,
    summarizeStockPositions,
} from '../lib/portfolio-summary';
import { calculatePositionMetrics } from '../lib/position-metrics';
import { closeOrReverse } from '../lib/position-actions';
import { cancelOrder, updateOrderQty } from '../lib/backend';
import { notify, placeQuickOrder } from '../lib/trade';
import type { Trade } from '../lib/types/order';
import type { ContractInfo } from '../lib/types/contract';
import type {
    AccountBalance,
    Margin,
    Position,
    StockPosition,
} from '../lib/types/portfolio';
import {
    compareNullable,
    createOrderTimeDescendingCompare,
    loadSortState,
    saveSortState,
    stableSort,
    toggleSort,
    type SortDirection,
    type SortState,
} from '../lib/table-sort';
import { SENSITIVE } from '../lib/privacy';
import { dateStrOffset } from '../lib/utils/kbars';
import {
    fmtInt,
    fmtMoney,
    fmtPrice,
    fmtSigned,
} from '../lib/utils/format';
import { vars } from '../theme.css';
import * as panel from './panel.css';
import * as styles from './bottom-dock.css';
import { ResolvedSymbolCell } from './symbol-cell';

type TabKey = 'positions' | 'orders' | 'account';

const POSITIONS_SORT_STORAGE_KEY = 'kau-ik-pro-positions-sort';
const ORDERS_SORT_STORAGE_KEY = 'kau-ik-pro-orders-sort';
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
type PositionSortKey = (typeof POSITION_SORT_KEYS)[number];
const ORDER_SORT_KEYS = [
    'symbol',
    'action',
    'price',
    'quantity',
    'status',
    'time',
] as const;
type OrderSortKey = (typeof ORDER_SORT_KEYS)[number];

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

const ORDER_SORT_DEFAULT_DIRECTIONS: Record<OrderSortKey, SortDirection> = {
    symbol: 'asc',
    action: 'asc',
    price: 'desc',
    quantity: 'desc',
    status: 'asc',
    time: 'desc',
};

interface PositionDisplayRow {
    position: Position;
    contract?: ContractInfo;
    displayPrice: ReturnType<typeof resolveDisplayPrice>;
    metrics: ReturnType<typeof calculatePositionMetrics>;
}

interface OrderDisplayRow {
    trade: Trade;
    fallbackRank: number;
    orderTs?: number | null;
    effectivePrice: number;
}

const ACTIVE_STATUSES = new Set([
    'PendingSubmit',
    'PreSubmitted',
    'Submitted',
    'PartFilled',
]);

function statusKind(status: string): 'ok' | 'pending' | 'bad' {
    if (status === 'Filled') return 'ok';
    if (ACTIVE_STATUSES.has(status)) return 'pending';
    return 'bad';
}

function getPositionsSortStorage(): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function loadPositionsSortState(): SortState<PositionSortKey> | null {
    const storage = getPositionsSortStorage();
    if (!storage) return null;
    return loadSortState(
        storage,
        POSITIONS_SORT_STORAGE_KEY,
        POSITION_SORT_KEYS,
    );
}

function getOrdersSortStorage(): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function loadOrdersSortState(): SortState<OrderSortKey> | null {
    const storage = getOrdersSortStorage();
    if (!storage) return null;
    return loadSortState(storage, ORDERS_SORT_STORAGE_KEY, ORDER_SORT_KEYS);
}

function comparePositionRows(
    a: PositionDisplayRow,
    b: PositionDisplayRow,
    sort: SortState<PositionSortKey>,
): number {
    const direction = sort.direction;

    if (sort.key === 'symbol') {
        const codeResult = compareNullable(
            a.position.code,
            b.position.code,
            direction,
        );
        if (codeResult !== 0) return codeResult;
        return compareNullable(a.contract?.name, b.contract?.name, direction);
    }

    if (sort.key === 'direction') {
        return compareNullable(
            a.position.direction === 'Buy' ? 0 : 1,
            b.position.direction === 'Buy' ? 0 : 1,
            direction,
        );
    }

    if (sort.key === 'quantity') {
        return compareNullable(
            a.position.quantity,
            b.position.quantity,
            direction,
        );
    }

    if (sort.key === 'cost') {
        return compareNullable(a.position.price, b.position.price, direction);
    }

    if (sort.key === 'currentPrice') {
        return compareNullable(
            a.displayPrice.value,
            b.displayPrice.value,
            direction,
        );
    }

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
}

function compareOrderRows(
    a: OrderDisplayRow,
    b: OrderDisplayRow,
    sort: SortState<OrderSortKey>,
    timeDescCompare: (a: OrderDisplayRow, b: OrderDisplayRow) => number,
): number {
    const direction = sort.direction;

    if (sort.key === 'symbol') {
        const codeResult = compareNullable(
            a.trade.contract.code,
            b.trade.contract.code,
            direction,
        );
        if (codeResult !== 0) return codeResult;
        return compareNullable(
            a.trade.contract.name,
            b.trade.contract.name,
            direction,
        );
    }

    if (sort.key === 'action') {
        return compareNullable(
            a.trade.order.action === 'Buy' ? 0 : 1,
            b.trade.order.action === 'Buy' ? 0 : 1,
            direction,
        );
    }

    if (sort.key === 'price') {
        return compareNullable(a.effectivePrice, b.effectivePrice, direction);
    }

    if (sort.key === 'quantity') {
        return compareNullable(
            a.trade.order.quantity,
            b.trade.order.quantity,
            direction,
        );
    }

    if (sort.key === 'status') {
        return compareNullable(
            a.trade.status.status,
            b.trade.status.status,
            direction,
        );
    }

    return direction === 'desc'
        ? timeDescCompare(a, b)
        : -timeDescCompare(a, b);
}

function fmtOrderTime(orderTs?: number | null): string {
    if (orderTs == null) return '—';
    const date = new Date(Number(orderTs));
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleTimeString('zh-TW', { hour12: false });
}

function sortAriaValue<Key extends string>(
    key: Key,
    sortState: SortState<Key> | null,
): 'ascending' | 'descending' | 'none' {
    if (sortState?.key !== key) return 'none';
    return sortState.direction === 'asc' ? 'ascending' : 'descending';
}

function sortIndicator<Key extends string>(
    key: Key,
    sortState: SortState<Key> | null,
): string {
    if (sortState?.key !== key) return '↕';
    return sortState.direction === 'asc' ? '▲' : '▼';
}

function PositionsTable({
    positions,
    onChanged,
}: {
    positions: Position[];
    onChanged: () => void;
}) {
    const [busyCode, setBusyCode] = useState<string | null>(null);
    const [sortState, setSortState] = useState<SortState<PositionSortKey> | null>(
        loadPositionsSortState,
    );
    const positionCodes = useMemo(
        () => positions.map((position) => position.code),
        [positions],
    );
    const quotes = useQuotes(positionCodes);
    const { contracts, snapshots } = usePositionMarketData(positions);
    const rows = useMemo<PositionDisplayRow[]>(
        () =>
            positions.map((position) => {
                const quote = quotes[position.code];
                const contract = contracts[position.code];
                const snapshot = snapshots[position.code];
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
            }),
        [contracts, positions, quotes, snapshots],
    );
    const sortedRows = useMemo(() => {
        if (!sortState) return rows;
        return stableSort(rows, (a, b) => comparePositionRows(a, b, sortState));
    }, [rows, sortState]);

    useEffect(() => {
        if (!sortState) return;
        const storage = getPositionsSortStorage();
        if (!storage) return;
        try {
            saveSortState(storage, POSITIONS_SORT_STORAGE_KEY, sortState);
        } catch {
            // Ignore private browsing or disabled storage; sorting still works in-memory.
        }
    }, [sortState]);

    const updateSort = (key: PositionSortKey) => {
        setSortState((current) =>
            toggleSort(current, key, POSITION_SORT_DEFAULT_DIRECTIONS[key]),
        );
    };

    const sortableHeader = (key: PositionSortKey, label: string) => {
        const active = sortState?.key === key;
        const stateLabel = active
            ? sortState.direction === 'asc'
                ? '升冪'
                : '降冪'
            : '未排序';

        return (
            <th
                scope='col'
                className={styles.th}
                aria-sort={sortAriaValue(key, sortState)}
            >
                <button
                    type='button'
                    className={styles.sortHeaderButton}
                    aria-label={`${label}：${stateLabel}，點選排序`}
                    onClick={() => updateSort(key)}
                >
                    <span>{label}</span>
                    <span className={styles.sortIndicator} aria-hidden='true'>
                        {sortIndicator(key, sortState)}
                    </span>
                </button>
            </th>
        );
    };

    const act = async (p: Position, mode: 'close' | 'reverse') => {
        if (busyCode) return;
        setBusyCode(p.code);
        try {
            await closeOrReverse(p, mode);
            onChanged();
        } catch {
            // closeOrReverse already notified
        } finally {
            setBusyCode(null);
        }
    };
    if (positions.length === 0) {
        return <div className={styles.emptyState}>NO OPEN POSITIONS · 無持倉</div>;
    }
    const maxAbsPnl = Math.max(1, ...positions.map((p) => Math.abs(p.pnl)));
    return (
        <table className={styles.table}>
            <thead>
                <tr>
                    {sortableHeader('symbol', '商品')}
                    {sortableHeader('direction', '方向')}
                    {sortableHeader('quantity', '數量')}
                    {sortableHeader('cost', '成本')}
                    {sortableHeader('currentPrice', '現價')}
                    {sortableHeader('pnl', '損益')}
                    <th
                        scope='col'
                        className={styles.th}
                        style={{ width: '18%' }}
                    >
                        損益分布
                    </th>
                    <th scope='col' className={styles.th} />
                </tr>
            </thead>
            <tbody>
                {sortedRows.map((row) => {
                    const p = row.position;
                    const dir = p.pnl > 0 ? 'up' : p.pnl < 0 ? 'down' : 'flat';
                    return (
                        <tr key={`${p.code}-${p.id}`}>
                            <td className={styles.td}>
                                <ResolvedSymbolCell
                                    code={p.code}
                                    type={row.contract?.security_type}
                                    fallbackName={row.contract?.name}
                                />
                            </td>
                            <td
                                className={`${styles.td} ${panel.dirText[p.direction === 'Buy' ? 'up' : 'down']}`}
                            >
                                {p.direction === 'Buy' ? '多 LONG' : '空 SHORT'}
                            </td>
                            <td className={`${styles.td} ${SENSITIVE}`}>
                                {fmtInt(p.quantity)}
                            </td>
                            <td className={`${styles.td} ${SENSITIVE}`}>
                                {fmtPrice(p.price)}
                            </td>
                            <td
                                className={styles.td}
                                title={row.displayPrice.title}
                            >
                                <span className={styles.priceWithSource}>
                                    <span>
                                        {fmtPrice(row.displayPrice.value)}
                                    </span>
                                    <span className={styles.priceSource}>
                                        {row.displayPrice.label}
                                    </span>
                                </span>
                            </td>
                            <td
                                className={`${styles.td} ${panel.dirText[dir]} ${SENSITIVE}`}
                            >
                                {fmtSigned(p.pnl, 0)}
                            </td>
                            <td className={styles.td}>
                                <div className={styles.pnlBar}>
                                    <div
                                        className={styles.pnlFill}
                                        style={{
                                            left: p.pnl >= 0 ? '50%' : undefined,
                                            right:
                                                p.pnl < 0 ? '50%' : undefined,
                                            width: `${(Math.abs(p.pnl) / maxAbsPnl) * 50}%`,
                                            background:
                                                p.pnl >= 0
                                                    ? vars.color.up
                                                    : vars.color.down,
                                        }}
                                    />
                                </div>
                            </td>
                            <td className={styles.td}>
                                <button
                                    className={styles.cancelBtn}
                                    disabled={busyCode === p.code}
                                    title='市價沖銷此倉位'
                                    onClick={() => act(p, 'close')}
                                >
                                    平
                                </button>{' '}
                                <button
                                    className={styles.cancelBtn}
                                    disabled={busyCode === p.code}
                                    title='市價反向兩倍（翻倉）'
                                    onClick={() => act(p, 'reverse')}
                                >
                                    反
                                </button>
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}

function QtyEditor({
    trade,
    onChanged,
}: {
    trade: Trade;
    onChanged: () => void;
}) {
    const [editing, setEditing] = useState(false);
    const [val, setVal] = useState('');
    if (!editing) {
        return (
            <button
                className={styles.cancelBtn}
                title='減量（輸入新數量）'
                onClick={() => {
                    setVal(
                        String(
                            trade.order.quantity -
                                trade.status.deal_quantity,
                        ),
                    );
                    setEditing(true);
                }}
            >
                改量
            </button>
        );
    }
    return (
        <input
            autoFocus
            className={styles.qtyInline}
            value={val}
            inputMode='numeric'
            onChange={(e) => setVal(e.target.value)}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false);
                if (e.key === 'Enter') {
                    const q = Number(val);
                    if (Number.isInteger(q) && q >= 1) {
                        updateOrderQty(trade.order.id, q)
                            .then(() => {
                                notify({
                                    kind: 'ok',
                                    title: '✏️ 改量已送出',
                                    body: `${trade.contract.code} → ${q}（僅能減量）`,
                                });
                                onChanged();
                            })
                            .catch((err) =>
                                notify({
                                    kind: 'err',
                                    title: '改量失敗',
                                    body:
                                        err instanceof Error
                                            ? err.message
                                            : String(err),
                                }),
                            );
                    }
                    setEditing(false);
                }
            }}
        />
    );
}

function OrdersTable({
    trades,
    onChanged,
}: {
    trades: Trade[];
    onChanged: () => void;
}) {
    const [cancelling, setCancelling] = useState<string | null>(null);
    const [sortState, setSortState] = useState<SortState<OrderSortKey> | null>(
        loadOrdersSortState,
    );
    const orderRows = useMemo<OrderDisplayRow[]>(
        () =>
            trades.map((trade, originalIndex) => ({
                trade,
                fallbackRank: trades.length - 1 - originalIndex,
                orderTs: trade.status.order_ts,
                effectivePrice:
                    trade.status.modified_price || trade.order.price,
            })),
        [trades],
    );
    const sortedRows = useMemo(() => {
        if (!sortState) {
            return stableSort(
                orderRows,
                (a, b) => a.fallbackRank - b.fallbackRank,
            );
        }
        const timeDescCompare = createOrderTimeDescendingCompare(orderRows);
        return stableSort(orderRows, (a, b) =>
            compareOrderRows(a, b, sortState, timeDescCompare),
        );
    }, [orderRows, sortState]);

    useEffect(() => {
        if (!sortState) return;
        const storage = getOrdersSortStorage();
        if (!storage) return;
        try {
            saveSortState(storage, ORDERS_SORT_STORAGE_KEY, sortState);
        } catch {
            // Ignore private browsing or disabled storage; sorting still works in-memory.
        }
    }, [sortState]);

    const updateSort = (key: OrderSortKey) => {
        setSortState((current) =>
            toggleSort(current, key, ORDER_SORT_DEFAULT_DIRECTIONS[key]),
        );
    };

    const sortableHeader = (key: OrderSortKey, label: string) => {
        const active = sortState?.key === key;
        const stateLabel = active
            ? sortState.direction === 'asc'
                ? '升冪'
                : '降冪'
            : '未排序';

        return (
            <th
                scope='col'
                className={styles.th}
                aria-sort={sortAriaValue(key, sortState)}
            >
                <button
                    type='button'
                    className={styles.sortHeaderButton}
                    aria-label={`${label}：${stateLabel}，點選排序`}
                    onClick={() => updateSort(key)}
                >
                    <span>{label}</span>
                    <span className={styles.sortIndicator} aria-hidden='true'>
                        {sortIndicator(key, sortState)}
                    </span>
                </button>
            </th>
        );
    };

    if (trades.length === 0) {
        return <div className={styles.emptyState}>NO ORDERS · 無委託</div>;
    }
    const doCancel = async (id: string) => {
        setCancelling(id);
        try {
            await cancelOrder(id);
            onChanged();
        } catch {
            // status refresh will surface reality
        } finally {
            setCancelling(null);
        }
    };
    return (
        <table className={styles.table}>
            <thead>
                <tr>
                    {sortableHeader('symbol', '商品')}
                    {sortableHeader('action', '買賣')}
                    {sortableHeader('price', '價格')}
                    {sortableHeader('quantity', '委託量')}
                    <th scope='col' className={styles.th}>
                        成交量
                    </th>
                    {sortableHeader('status', '狀態')}
                    {sortableHeader('time', '時間')}
                    <th scope='col' className={styles.th}>
                        訊息
                    </th>
                    <th scope='col' className={styles.th} />
                </tr>
            </thead>
            <tbody>
                {sortedRows.map(({ trade: t, effectivePrice }) => {
                    const st = t.status.status;
                    return (
                        <tr key={t.order.id}>
                            <td className={styles.td}>
                                <ResolvedSymbolCell
                                    code={t.contract.code}
                                    type={t.contract.security_type}
                                    fallbackName={t.contract.name}
                                />
                            </td>
                            <td
                                className={`${styles.td} ${panel.dirText[t.order.action === 'Buy' ? 'up' : 'down']}`}
                            >
                                {t.order.action === 'Buy' ? '買' : '賣'}
                            </td>
                            <td className={styles.td}>
                                {fmtPrice(effectivePrice)}
                            </td>
                            <td className={`${styles.td} ${SENSITIVE}`}>
                                {fmtInt(t.order.quantity)}
                            </td>
                            <td className={`${styles.td} ${SENSITIVE}`}>
                                {fmtInt(t.status.deal_quantity)}
                            </td>
                            <td className={styles.td}>
                                <span
                                    className={
                                        styles.statusChip[statusKind(st)]
                                    }
                                >
                                    {st}
                                </span>
                            </td>
                            <td className={styles.td}>
                                {fmtOrderTime(t.status.order_ts)}
                            </td>
                            <td
                                className={styles.td}
                                style={{
                                    maxWidth: '16rem',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {t.status.msg || '—'}
                            </td>
                            <td className={styles.td}>
                                {ACTIVE_STATUSES.has(st) && (
                                    <>
                                        <QtyEditor
                                            trade={t}
                                            onChanged={onChanged}
                                        />{' '}
                                        <button
                                            className={styles.cancelBtn}
                                            disabled={
                                                cancelling === t.order.id
                                            }
                                            onClick={() =>
                                                doCancel(t.order.id)
                                            }
                                        >
                                            {cancelling === t.order.id
                                                ? '…'
                                                : 'CANCEL'}
                                        </button>
                                    </>
                                )}
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}

function AccountView({
    positions,
    balance,
    margin,
}: {
    positions: Position[];
    balance?: AccountBalance;
    margin?: Margin;
}) {
    const stockPos = useMemo(
        () =>
            positions.filter((p): p is StockPosition => 'yd_quantity' in p),
        [positions],
    );
    const stockCodes = useMemo(
        () => stockPos.map((position) => position.code),
        [stockPos],
    );
    const quotes = useQuotes(stockCodes);
    const { contracts, snapshots } = usePositionMarketData(stockPos);

    // 今日已實現損益（60 秒輪詢 — 玉山帳務 API 有嚴格速率限制）
    const realizedPoll = usePoll<number>(
        useCallback(async () => {
            const today = dateStrOffset(0);
            const rows = await apiPost<{ date: string; pnl: number }[]>(
                '/api/v1/portfolio/profit_loss',
                {
                    begin_date: today,
                    end_date: today,
                    account_type: 'S',
                    unit: 'Common',
                },
            ).catch(() => []);
            return rows.reduce((s, r) => s + (Number(r.pnl) || 0), 0);
        }, []),
        60000,
    );
    const todayRealized = realizedPoll.data ?? 0;

    const stockSummary = useMemo(
        () =>
            summarizeStockPositions(
                stockPos.map((position) => {
                    const quote = quotes[position.code];
                    const contract = contracts[position.code];
                    const snapshot = snapshots[position.code];
                    return {
                        code: position.code,
                        quantity: position.quantity,
                        averagePrice: position.price,
                        pnl: position.pnl,
                        reference: contract?.reference,
                        displayPrice: resolveDisplayPrice({
                            tickClose:
                                quote?.tick?.close === undefined
                                    ? undefined
                                    : Number(quote.tick.close),
                            snapshotClose: snapshot?.close,
                            brokerLastPrice: position.last_price,
                            reference: contract?.reference,
                            previousClose: contract?.previous_close,
                        }),
                    };
                }),
            ),
        [contracts, quotes, snapshots, stockPos],
    );
    const {
        totalPnl,
        totalCost,
        totalMarketValue,
        todayUnrealized,
        missingPriceCount,
    } = stockSummary;
    const missingPriceHint = formatMissingPriceCountHint(missingPriceCount);
    const appendMissingPriceHint = (hint: string) =>
        missingPriceHint ? `${hint}；${missingPriceHint}` : hint;
    const todayUnreal = todayUnrealized;
    const todayTotal = todayRealized + todayUnreal;
    const ydMkt = totalMarketValue - todayUnreal; // 今日報酬率基準：昨日市值

    const dirOf = (v: number): 'up' | 'down' | 'flat' =>
        v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
    const withPct = (v: number, base: number) =>
        `${fmtSigned(v, 0)}${base > 0 ? ` (${((v / base) * 100).toFixed(2)}%)` : ''}`;

    const items: {
        label: string;
        value: string;
        dir?: 'up' | 'down' | 'flat';
        hint?: string;
    }[] = [];
    if (stockPos.length > 0) {
        items.push(
            {
                label: '總未實現損益（報酬率）',
                value: withPct(totalPnl, totalCost),
                dir: dirOf(totalPnl),
                hint: '券商回報的未實現損益加總；報酬率 = 未實現損益 ÷ 持股成本（成交均價×股數）',
            },
            {
                label: '今日總損益（報酬率）',
                value: withPct(todayTotal, ydMkt),
                dir: dirOf(todayTotal),
                hint: appendMissingPriceHint(
                    '今日已實現 + 今日未實現變化；報酬率以昨日市值為基準',
                ),
            },
            {
                label: '今日已實現損益',
                value: fmtSigned(todayRealized, 0),
                dir: dirOf(todayRealized),
                hint: '今日賣出部位的已實現損益（券商帳務）',
            },
            {
                label: '今日未實現損益變化',
                value: fmtSigned(todayUnreal, 0),
                dir: dirOf(todayUnreal),
                hint: appendMissingPriceHint(
                    'Σ(現價 − 今日參考價) × 持股。以參考價為基準：除權息日已排除除息缺口，呈現市場真實漲跌（股息另計）；故與以昨收為基準的券商 app 在除權息日會有差異',
                ),
            },
            {
                label: '總市值 Market Value',
                value: fmtMoney(totalMarketValue),
                hint: appendMissingPriceHint('Σ 現價 × 持股'),
            },
        );
    }
    if (balance) {
        items.push({
            label: '證券交割帳戶 Balance',
            value: fmtMoney(balance.acc_balance),
        });
    }
    // 期貨保證金區塊 — 只在有期貨帳戶資料時顯示（純證券券商隱藏）
    const hasMargin =
        margin &&
        (margin.equity !== 0 ||
            margin.available_margin !== 0 ||
            margin.initial_margin !== 0);
    if (hasMargin) {
        items.push(
            { label: '權益數 Equity', value: fmtMoney(margin.equity) },
            {
                label: '可用保證金 Available',
                value: fmtMoney(margin.available_margin),
            },
            {
                label: '原始保證金 Initial',
                value: fmtMoney(margin.initial_margin),
            },
            {
                label: '維持保證金 Maint.',
                value: fmtMoney(margin.maintenance_margin),
            },
            {
                label: '期貨平倉損益 Settle P&L',
                value: fmtSigned(margin.future_settle_profitloss, 0),
                dir: dirOf(margin.future_settle_profitloss),
            },
        );
    }
    if (items.length === 0) {
        return <div className={styles.emptyState}>NO ACCOUNT DATA · 無帳務資料</div>;
    }
    return (
        <div className={styles.accountGrid}>
            {items.map((it) => (
                <div key={it.label} className={styles.statCard} title={it.hint}>
                    <span className={styles.statCardLabel}>
                        {it.label}
                        {it.hint ? ' ⓘ' : ''}
                    </span>
                    <span
                        className={`${styles.statCardValue} ${it.dir ? panel.dirText[it.dir] : ''} ${SENSITIVE}`}
                    >
                        {it.value}
                    </span>
                </div>
            ))}
        </div>
    );
}

export function BottomDock({
    positions,
    trades,
    balance,
    margin,
    onTradesChanged,
    onRefreshAll,
}: {
    positions: Position[];
    trades: Trade[];
    balance?: AccountBalance;
    margin?: Margin;
    onTradesChanged: () => void;
    onRefreshAll?: () => Promise<void> | void;
}) {
    const [tab, setTab] = useState<TabKey>('positions');
    const [refreshing, setRefreshing] = useState(false);
    const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
    const doRefresh = async () => {
        if (refreshing || !onRefreshAll) return;
        setRefreshing(true);
        try {
            await onRefreshAll();
            setRefreshedAt(new Date());
        } finally {
            setRefreshing(false);
        }
    };
    const activeOrders = trades.filter((t) =>
        ACTIVE_STATUSES.has(t.status.status),
    ).length;

    const tabs: { key: TabKey; label: string }[] = [
        { key: 'positions', label: `持倉 Positions [${positions.length}]` },
        { key: 'orders', label: `委託 Orders [${activeOrders}/${trades.length}]` },
        { key: 'account', label: '帳務 Account' },
    ];

    return (
        <div className={styles.dock}>
            <div className={styles.tabBar}>
                {tabs.map((t) => (
                    <button
                        key={t.key}
                        className={styles.tab[tab === t.key ? 'on' : 'off']}
                        onClick={() => setTab(t.key)}
                    >
                        {t.label}
                    </button>
                ))}
                {onRefreshAll && (
                    <button
                        className={styles.tab.off}
                        style={{ marginLeft: 'auto' }}
                        disabled={refreshing}
                        title='向券商重新查詢持倉/委託/帳務（平時由主動回報自動更新）'
                        onClick={() => void doRefresh()}
                    >
                        {refreshing
                            ? '↻ 更新中…'
                            : `↻ 重整${
                                  refreshedAt
                                      ? ` · ${refreshedAt.toLocaleTimeString('zh-TW', { hour12: false })}`
                                      : ''
                              }`}
                    </button>
                )}
            </div>
            <div className={panel.panelBody}>
                {tab === 'positions' && (
                    <PositionsTable
                        positions={positions}
                        onChanged={onTradesChanged}
                    />
                )}
                {tab === 'orders' && (
                    <OrdersTable trades={trades} onChanged={onTradesChanged} />
                )}
                {tab === 'account' && (
                    <AccountView
                        positions={positions}
                        balance={balance}
                        margin={margin}
                    />
                )}
            </div>
        </div>
    );
}
