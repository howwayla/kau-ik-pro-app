// src/components/bottom-dock.tsx — positions / orders / account tabs

import { useCallback, useEffect, useState } from 'react';
import { usePoll } from '../hooks/use-poll';
import { apiPost } from '../lib/api';
import { ensureContract } from '../lib/contracts-cache';
import { closeOrReverse } from '../lib/position-actions';
import { cancelOrder, updateOrderQty } from '../lib/backend';
import { notify, placeQuickOrder } from '../lib/trade';
import type { Trade } from '../lib/types/order';
import type {
    AccountBalance,
    Margin,
    Position,
    StockPosition,
} from '../lib/types/portfolio';
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

type TabKey = 'positions' | 'orders' | 'account';

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

function PositionsTable({
    positions,
    onChanged,
}: {
    positions: Position[];
    onChanged: () => void;
}) {
    const [busyCode, setBusyCode] = useState<string | null>(null);
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
                    <th className={styles.th}>代碼</th>
                    <th className={styles.th}>方向</th>
                    <th className={styles.th}>數量</th>
                    <th className={styles.th}>成本</th>
                    <th className={styles.th}>現價</th>
                    <th className={styles.th}>損益</th>
                    <th className={styles.th} style={{ width: '18%' }}>
                        損益分布
                    </th>
                    <th className={styles.th} />
                </tr>
            </thead>
            <tbody>
                {positions.map((p) => {
                    const dir = p.pnl > 0 ? 'up' : p.pnl < 0 ? 'down' : 'flat';
                    return (
                        <tr key={`${p.code}-${p.id}`}>
                            <td className={styles.td}>{p.code}</td>
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
                            <td className={styles.td}>
                                {fmtPrice(p.last_price)}
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
                    <th className={styles.th}>代碼</th>
                    <th className={styles.th}>買賣</th>
                    <th className={styles.th}>價格</th>
                    <th className={styles.th}>委託量</th>
                    <th className={styles.th}>成交量</th>
                    <th className={styles.th}>狀態</th>
                    <th className={styles.th}>訊息</th>
                    <th className={styles.th} />
                </tr>
            </thead>
            <tbody>
                {[...trades].reverse().map((t) => {
                    const st = t.status.status;
                    return (
                        <tr key={t.order.id}>
                            <td className={styles.td}>{t.contract.code}</td>
                            <td
                                className={`${styles.td} ${panel.dirText[t.order.action === 'Buy' ? 'up' : 'down']}`}
                            >
                                {t.order.action === 'Buy' ? '買' : '賣'}
                            </td>
                            <td className={styles.td}>
                                {fmtPrice(
                                    t.status.modified_price || t.order.price,
                                )}
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
    const stockPos = positions.filter(
        (p): p is StockPosition => 'yd_quantity' in p,
    );

    // 今日未實現變化的基準＝「今日參考價」：除權息日參考價已調整股息，
    // 算出來的是市場真實漲跌（除息缺口不計為虧損 — 股息另行入帳）。
    // 若想對齊以昨收為基準的券商 app 口徑，改用 c.previous_close 即可。
    const codesKey = stockPos.map((p) => p.code).join(',');
    const [refs, setRefs] = useState<Record<string, number>>({});
    useEffect(() => {
        let alive = true;
        for (const p of stockPos) {
            if (refs[p.code]) continue;
            ensureContract(p.code)
                .then((c) => {
                    if (alive && c.reference > 0) {
                        setRefs((prev) =>
                            prev[p.code] === c.reference
                                ? prev
                                : { ...prev, [p.code]: c.reference },
                        );
                    }
                })
                .catch(() => undefined);
        }
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [codesKey]);

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
    const todayTotal = todayRealized + todayUnreal;
    const ydMkt = totalMkt - todayUnreal; // 今日報酬率基準：昨日市值

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
                hint: '今日已實現 + 今日未實現變化；報酬率以昨日市值為基準',
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
                hint: 'Σ(現價 − 今日參考價) × 持股。以參考價為基準：除權息日已排除除息缺口，呈現市場真實漲跌（股息另計）；故與以昨收為基準的券商 app 在除權息日會有差異',
            },
            {
                label: '總市值 Market Value',
                value: fmtMoney(totalMkt),
                hint: 'Σ 現價 × 持股',
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
