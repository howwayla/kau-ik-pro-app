// src/components/watchlist.tsx — live watchlist; click row to select symbol

import { useEffect, useState } from 'react';
import { useQuote } from '../hooks/use-stream';
import type { WatchItem } from '../hooks/use-watchlist';
import { fetchKbars } from '../lib/backend';
import { useRegulatoryFlag } from '../lib/regulatory';
import type { ContractInfo, SecurityType } from '../lib/types/contract';
import { fmtPct, fmtPrice, fmtSigned } from '../lib/utils/format';
import { dateStrOffset, kbarsToCandles } from '../lib/utils/kbars';
import * as panel from './panel.css';
import * as styles from './watchlist.css';

/** 當日 1 分 K 收盤價迷你走勢線（最後一點用即時價補） */
function Sparkline({
    contract,
    last,
}: {
    contract: ContractInfo;
    last?: number;
}) {
    const [closes, setCloses] = useState<number[] | null>(null);
    useEffect(() => {
        let dead = false;
        fetchKbars(contract, dateStrOffset(0), dateStrOffset(0))
            .then((k) => {
                if (!dead) {
                    setCloses(kbarsToCandles(k).map((b) => b.close));
                }
            })
            .catch(() => {
                if (!dead) setCloses(null);
            });
        return () => {
            dead = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contract.code]);

    const W = 64;
    const H = 20;
    if (!closes || closes.length < 2) {
        return <span className={styles.sparkCell} />;
    }
    const pts = last && last > 0 ? [...closes, last] : closes;
    const ref = contract.reference;
    const lo = Math.min(...pts, ref || Infinity);
    const hi = Math.max(...pts, ref || -Infinity);
    const span = hi - lo || 1;
    const y = (v: number) => H - 2 - ((v - lo) / span) * (H - 4);
    const x = (i: number) => (i / (pts.length - 1)) * (W - 2) + 1;
    const lastClose = pts[pts.length - 1]!;
    const dir =
        !ref || lastClose === ref ? 'flat' : lastClose > ref ? 'up' : 'down';
    return (
        <span className={`${styles.sparkCell} ${panel.dirText[dir]}`}>
            <svg width={W} height={H} aria-hidden='true'>
                {ref > 0 && (
                    <line
                        x1={0}
                        y1={y(ref)}
                        x2={W}
                        y2={y(ref)}
                        stroke='currentColor'
                        strokeWidth={1}
                        strokeDasharray='2 3'
                        opacity={0.35}
                    />
                )}
                <polyline
                    fill='none'
                    stroke='currentColor'
                    strokeWidth={1.2}
                    points={pts.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
                />
            </svg>
        </span>
    );
}

function WatchRow({
    item,
    selected,
    onSelect,
    onRemove,
    showSpark,
}: {
    item: WatchItem;
    selected: boolean;
    onSelect: (c: ContractInfo) => void;
    onRemove: (code: string) => void;
    showSpark: boolean;
}) {
    const quote = useQuote(item.contract.code);
    const tick = quote?.tick;
    const regFlag = useRegulatoryFlag(item.contract.code);

    const close = tick ? Number(tick.close) : item.snapshot?.close;
    const ref = item.contract.reference;
    const chg = tick?.price_chg
        ? Number(tick.price_chg)
        : close !== undefined && ref
          ? close - ref
          : undefined;
    const pct = tick?.pct_chg
        ? Number(tick.pct_chg)
        : chg !== undefined && ref
          ? (chg / ref) * 100
          : undefined;

    const dir = chg === undefined || chg === 0 ? 'flat' : chg > 0 ? 'up' : 'down';
    // 觸及漲/跌停 → 價格填底色標註。優先用 API 權威旗標
    //（isLimitUpPrice/isLimitDownPrice，涵蓋無漲跌幅限制的特殊商品）；
    // 無旗標時（mock/快照）退回與合約漲跌停價比對
    const limitHit = tick?.limit_up
        ? ('up' as const)
        : tick?.limit_down
          ? ('down' as const)
          : close !== undefined && close > 0
            ? item.contract.limit_up > 0 && close >= item.contract.limit_up
                ? ('up' as const)
                : item.contract.limit_down > 0 &&
                    close <= item.contract.limit_down
                  ? ('down' as const)
                  : null
            : null;
    // re-key by flashSeq so the flash animation replays only on real deals
    const flashDir =
        !quote?.flashSeq ? 'none' : quote.lastDir === -1 ? 'down' : 'up';

    return (
        <div
            key={`${item.contract.code}-${quote?.flashSeq ?? 0}`}
            className={`${styles.row[selected ? 'selected' : 'normal']} ${
                showSpark ? styles.rowSpark : ''
            } ${styles.flash[flashDir]}`}
            onClick={() => onSelect(item.contract)}
        >
            <span className={styles.code}>
                {item.contract.code}
                {regFlag === 'punish' && (
                    <span className={styles.rowBadge.punish} title='處置股'>
                        處
                    </span>
                )}
                {regFlag === 'attention' && (
                    <span className={styles.rowBadge.attention} title='注意股'>
                        注
                    </span>
                )}
                {tick?.simtrade && (
                    <span className={styles.rowBadge.trial} title='試算撮合'>
                        試
                    </span>
                )}
            </span>
            {showSpark && <Sparkline contract={item.contract} last={close} />}
            <span
                className={`${styles.price} ${
                    limitHit
                        ? styles.priceLimit[limitHit]
                        : panel.dirText[dir]
                }`}
                title={
                    limitHit
                        ? limitHit === 'up'
                            ? '漲停'
                            : '跌停'
                        : undefined
                }
            >
                {fmtPrice(close)}
            </span>
            <span className={styles.name}>{item.contract.name}</span>
            <span className={`${styles.change} ${panel.dirText[dir]}`}>
                {fmtSigned(chg)} {fmtPct(pct)}
            </span>
            <button
                className={styles.removeBtn}
                title={`移除 ${item.contract.code}`}
                onClick={(e) => {
                    e.stopPropagation(); // don't also select the row
                    onRemove(item.contract.code);
                }}
            >
                ✕
            </button>
        </div>
    );
}

export function Watchlist({
    items,
    selectedCode,
    onSelect,
    onAdd,
    onRemove,
    lists = [],
    activeListId = null,
    onSelectList,
}: {
    items: WatchItem[];
    selectedCode: string | null;
    onSelect: (c: ContractInfo) => void;
    onAdd: (code: string, type: SecurityType) => Promise<unknown>;
    onRemove: (code: string) => void;
    lists?: { id: string; name: string }[];
    activeListId?: string | null;
    onSelectList?: (id: string) => void;
}) {
    const [input, setInput] = useState('');
    const [type, setType] = useState<SecurityType>('STK');
    const [busy, setBusy] = useState(false);
    const [spark, setSpark] = useState(
        () => localStorage.getItem('sj-pro-watchlist-spark') === '1',
    );

    const toggleSpark = () => {
        setSpark((s) => {
            localStorage.setItem('sj-pro-watchlist-spark', s ? '0' : '1');
            return !s;
        });
    };

    const submit = async () => {
        const code = input.trim().toUpperCase();
        if (!code || busy) return;
        setBusy(true);
        try {
            await onAdd(code, type);
            setInput('');
        } catch {
            // keep input so user can fix typo
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            {lists.length > 1 && onSelectList && (
                <div className={styles.addRow}>
                    <select
                        className={styles.typeSelect}
                        style={{ flex: 1 }}
                        value={activeListId ?? ''}
                        onChange={(e) => onSelectList(e.target.value)}
                        title='切換自選清單（含從富果會員匯入的清單）'
                    >
                        {lists.map((l) => (
                            <option key={l.id} value={l.id}>
                                {l.name}
                            </option>
                        ))}
                    </select>
                </div>
            )}
            <div className={panel.panelBody}>
                <div className={styles.list}>
                    {items.map((item) => (
                        <WatchRow
                            key={item.contract.code}
                            item={item}
                            selected={item.contract.code === selectedCode}
                            onSelect={onSelect}
                            onRemove={onRemove}
                            showSpark={spark}
                        />
                    ))}
                </div>
            </div>
            <div className={styles.addRow}>
                <input
                    className={styles.addInput}
                    placeholder='代碼 e.g. 2330'
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && submit()}
                />
                <select
                    className={styles.typeSelect}
                    value={type ?? 'STK'}
                    onChange={(e) => setType(e.target.value as SecurityType)}
                >
                    <option value='STK'>股</option>
                    <option value='FUT'>期</option>
                </select>
                <button className={panel.btn} onClick={submit} disabled={busy}>
                    +
                </button>
                <button
                    className={panel.btn}
                    style={spark ? undefined : { opacity: 0.45 }}
                    title={spark ? '隱藏走勢線' : '顯示當日走勢線'}
                    onClick={toggleSpark}
                >
                    📈
                </button>
            </div>
        </>
    );
}
