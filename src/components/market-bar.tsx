// src/components/market-bar.tsx — index / futures basis strip in the header

import { useCallback } from 'react';
import { usePoll } from '../hooks/use-poll';
import { useQuote } from '../hooks/use-stream';
import { fetchSnapshots } from '../lib/shioaji';
import type { Snapshot } from '../lib/types/market';
import { fmtPct, fmtPrice, fmtSigned } from '../lib/utils/format';
import * as panel from './panel.css';
import * as styles from './hud-header.css';

const TSE_INDEX = {
    security_type: 'IND' as const,
    exchange: 'TSE' as const,
    code: '001',
    target_code: null,
};
const TXF = {
    security_type: 'FUT' as const,
    exchange: 'TAIFEX' as const,
    code: 'TXFR1',
    target_code: null,
};

export function MarketBar() {
    const { data } = usePoll<Snapshot[]>(
        useCallback(() => fetchSnapshots([TSE_INDEX, TXF]), []),
        10000,
    );
    const txfLive = useQuote('TXFR1');

    const index = data?.find((s) => s.code === '001');
    const txfSnap = data?.find((s) => s.code !== '001');
    const txfClose = txfLive?.tick
        ? Number(txfLive.tick.close)
        : txfSnap?.close;
    const basis =
        index && txfClose !== undefined ? txfClose - index.close : undefined;

    if (!index) return null;
    const dir =
        index.change_price > 0 ? 'up' : index.change_price < 0 ? 'down' : 'flat';
    const basisDir =
        basis === undefined || basis === 0 ? 'flat' : basis > 0 ? 'up' : 'down';

    return (
        <>
            <div className={styles.chip}>
                <span className={styles.chipLabel}>加權</span>
                <span className={panel.dirText[dir]}>
                    {fmtPrice(index.close)} {fmtPct(index.change_rate)}
                </span>
            </div>
            {basis !== undefined && (
                <div className={styles.chip} title='台指期 − 加權指數（價差）'>
                    <span className={styles.chipLabel}>基差</span>
                    <span className={panel.dirText[basisDir]}>
                        {fmtSigned(basis, 0)}
                    </span>
                </div>
            )}
        </>
    );
}
