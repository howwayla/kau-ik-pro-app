// src/components/quote-board.tsx — selected symbol mega display

import { useQuote } from '../hooks/use-stream';
import type { ContractInfo } from '../lib/types/contract';
import type { Snapshot } from '../lib/types/market';
import { fmtInt, fmtPct, fmtPrice, fmtSigned } from '../lib/utils/format';
import * as panel from './panel.css';
import * as styles from './quote-board.css';

export function QuoteBoard({
    contract,
    snapshot,
}: {
    contract: ContractInfo;
    snapshot?: Snapshot;
}) {
    const quote = useQuote(contract.code);
    const tick = quote?.tick;

    const close = tick ? Number(tick.close) : snapshot?.close;
    const ref = contract.reference;
    const chg = tick?.price_chg
        ? Number(tick.price_chg)
        : snapshot?.change_price;
    const pct = tick?.pct_chg
        ? Number(tick.pct_chg)
        : snapshot?.change_rate;
    const open = tick ? Number(tick.open) : snapshot?.open;
    const high = tick ? Number(tick.high) : snapshot?.high;
    const low = tick ? Number(tick.low) : snapshot?.low;
    const vol = tick?.total_volume ?? snapshot?.total_volume;

    const dir =
        chg === undefined || chg === 0 ? 'flat' : chg > 0 ? 'up' : 'down';

    return (
        <div className={`${styles.board} drag-handle`}>
            <div className={styles.symbolBlock}>
                <span className={styles.symbolCode}>{contract.code}</span>
                <span className={styles.symbolName}>{contract.name}</span>
            </div>

            <span className={styles.bigPrice[dir]}>{fmtPrice(close)}</span>

            <div className={`${styles.changeBlock} ${panel.dirText[dir]}`}>
                <span>{fmtSigned(chg)}</span>
                <span>{fmtPct(pct)}</span>
            </div>

            <div className={styles.statGrid}>
                <span className={styles.statLabel}>開</span>
                <span className={styles.statLabel}>高</span>
                <span className={styles.statLabel}>低</span>
                <span className={styles.statLabel}>量</span>
                <span className={styles.statValue}>{fmtPrice(open)}</span>
                <span className={`${styles.statValue} ${panel.dirText.up}`}>
                    {fmtPrice(high)}
                </span>
                <span className={`${styles.statValue} ${panel.dirText.down}`}>
                    {fmtPrice(low)}
                </span>
                <span className={styles.statValue}>{fmtInt(vol)}</span>
                <span className={styles.statLabel}>參考</span>
                <span className={styles.statLabel}>漲停</span>
                <span className={styles.statLabel}>跌停</span>
                <span className={styles.statLabel}>時間</span>
                <span className={styles.statValue}>{fmtPrice(ref)}</span>
                <span className={`${styles.statValue} ${panel.dirText.up}`}>
                    {fmtPrice(contract.limit_up)}
                </span>
                <span className={`${styles.statValue} ${panel.dirText.down}`}>
                    {fmtPrice(contract.limit_down)}
                </span>
                <span className={styles.statValue}>
                    {tick?.time?.slice(0, 8) ?? '—'}
                </span>
            </div>
        </div>
    );
}
