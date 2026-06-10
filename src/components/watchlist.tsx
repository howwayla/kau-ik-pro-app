// src/components/watchlist.tsx — live watchlist; click row to select symbol

import { useState } from 'react';
import { useQuote } from '../hooks/use-stream';
import type { WatchItem } from '../hooks/use-watchlist';
import type { ContractInfo, SecurityType } from '../lib/types/contract';
import { fmtPct, fmtPrice, fmtSigned } from '../lib/utils/format';
import * as panel from './panel.css';
import * as styles from './watchlist.css';

function WatchRow({
    item,
    selected,
    onSelect,
}: {
    item: WatchItem;
    selected: boolean;
    onSelect: (c: ContractInfo) => void;
}) {
    const quote = useQuote(item.contract.code);
    const tick = quote?.tick;

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
    // re-key by flashSeq so the flash animation replays only on real deals
    const flashDir =
        !quote?.flashSeq ? 'none' : quote.lastDir === -1 ? 'down' : 'up';

    return (
        <div
            key={`${item.contract.code}-${quote?.flashSeq ?? 0}`}
            className={`${styles.row[selected ? 'selected' : 'normal']} ${styles.flash[flashDir]}`}
            onClick={() => onSelect(item.contract)}
        >
            <span className={styles.code}>{item.contract.code}</span>
            <span className={`${styles.price} ${panel.dirText[dir]}`}>
                {fmtPrice(close)}
            </span>
            <span className={styles.name}>{item.contract.name}</span>
            <span className={`${styles.change} ${panel.dirText[dir]}`}>
                {fmtSigned(chg)} {fmtPct(pct)}
            </span>
        </div>
    );
}

export function Watchlist({
    items,
    selectedCode,
    onSelect,
    onAdd,
}: {
    items: WatchItem[];
    selectedCode: string | null;
    onSelect: (c: ContractInfo) => void;
    onAdd: (code: string, type: SecurityType) => Promise<unknown>;
}) {
    const [input, setInput] = useState('');
    const [type, setType] = useState<SecurityType>('STK');
    const [busy, setBusy] = useState(false);

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
            <div className={panel.panelBody}>
                <div className={styles.list}>
                    {items.map((item) => (
                        <WatchRow
                            key={item.contract.code}
                            item={item}
                            selected={item.contract.code === selectedCode}
                            onSelect={onSelect}
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
            </div>
        </>
    );
}
