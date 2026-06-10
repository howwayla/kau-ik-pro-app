// src/components/scanner-panel.tsx — market movers leaderboard

import { useEffect, useState } from 'react';
import { fetchScanner } from '../lib/shioaji';
import type { ScannerItem, ScannerType } from '../lib/types/market';
import { fmtPct, fmtPrice } from '../lib/utils/format';
import * as panel from './panel.css';
import * as styles from './scanner-panel.css';

const MODES: { key: ScannerType; label: string }[] = [
    { key: 'ChangePercentRank', label: '漲幅' },
    { key: 'VolumeRank', label: '量' },
    { key: 'AmountRank', label: '額' },
];

export function ScannerPanel({
    onPick,
}: {
    onPick: (code: string) => void;
}) {
    const [mode, setMode] = useState<ScannerType>('ChangePercentRank');
    const [items, setItems] = useState<ScannerItem[]>([]);
    const [error, setError] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setError(false);
        const load = () =>
            fetchScanner(mode, 20)
                .then((d) => !cancelled && setItems(d))
                .catch(() => !cancelled && setError(true));
        load();
        const t = setInterval(load, 30000);
        return () => {
            cancelled = true;
            clearInterval(t);
        };
    }, [mode]);

    return (
        <>
            <div className={styles.switcher}>
                {MODES.map((m) => (
                    <button
                        key={m.key}
                        className={styles.sw[mode === m.key ? 'on' : 'off']}
                        onClick={() => setMode(m.key)}
                    >
                        {m.label}
                    </button>
                ))}
            </div>
            <div className={panel.panelBody}>
                {error && (
                    <div
                        style={{ padding: '1rem', textAlign: 'center' }}
                        className={styles.scName}
                    >
                        排行資料無法取得
                    </div>
                )}
                {items.map((it, i) => {
                    const dir =
                        it.change_price > 0
                            ? 'up'
                            : it.change_price < 0
                              ? 'down'
                              : 'flat';
                    const pct =
                        it.close && it.change_price
                            ? (it.change_price /
                                  (it.close - it.change_price)) *
                              100
                            : 0;
                    return (
                        <div
                            key={it.code}
                            className={styles.row}
                            onClick={() => onPick(it.code)}
                        >
                            <span className={styles.rank}>
                                {String(i + 1).padStart(2, '0')}
                            </span>
                            <span>{it.code}</span>
                            <span className={styles.scName}>{it.name}</span>
                            <span
                                className={`${styles.scValue} ${panel.dirText[dir]}`}
                            >
                                {fmtPrice(it.close)} {fmtPct(pct)}
                            </span>
                        </div>
                    );
                })}
            </div>
        </>
    );
}
