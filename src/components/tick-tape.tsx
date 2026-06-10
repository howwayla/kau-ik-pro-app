// src/components/tick-tape.tsx — time & sales feed.
// Preloads today's recent history ticks, then streams live deals on top.
// Times show full microsecond precision (HH:MM:SS.ffffff).

import { useEffect, useState } from 'react';
import { fetchLastTicks } from '../lib/shioaji';
import { onAnyTick } from '../lib/stream';
import type { ContractBase } from '../lib/types/contract';
import type { HistoryTicks } from '../lib/types/tick';
import { fmtInt, fmtPrice } from '../lib/utils/format';
import { dateStrOffset } from '../lib/utils/kbars';
import * as panel from './panel.css';
import * as styles from './tick-tape.css';

const MAX_ROWS = 120;

interface TapeRow {
    time: string; // HH:MM:SS.ffffff
    close: number | string;
    volume: number;
    tick_type: number; // 1=buy 2=sell 0=unknown
}

// normalize to HH:MM:SS.ffffff (6 fraction digits)
function fmtTickTime(t: string): string {
    const [hms = '', frac = ''] = t.split('.');
    return `${hms}.${frac.padEnd(6, '0').slice(0, 6)}`;
}

// futures night-session ticks are filed under the NEXT trading date —
// try tomorrow first for FUT/OPT, fall back to today.
async function loadHistory(
    contract: ContractBase,
    count: number,
): Promise<HistoryTicks> {
    const isFop =
        contract.security_type === 'FUT' || contract.security_type === 'OPT';
    if (isFop) {
        try {
            const next = await fetchLastTicks(
                contract,
                count,
                dateStrOffset(-1),
            );
            if (next.datetime.length > 0) return next;
        } catch {
            // fall back to today
        }
    }
    return fetchLastTicks(contract, count);
}

export function TickTape({ contract }: { contract: ContractBase }) {
    const [rows, setRows] = useState<TapeRow[]>([]);
    const [loading, setLoading] = useState(true);

    // history preload, then live stream on top
    useEffect(() => {
        let cancelled = false;
        setRows([]);
        setLoading(true);

        loadHistory(contract, MAX_ROWS)
            .then((h) => {
                if (cancelled) return;
                const hist: TapeRow[] = [];
                for (let i = h.datetime.length - 1; i >= 0; i--) {
                    const dt = h.datetime[i];
                    if (!dt) continue;
                    hist.push({
                        time: fmtTickTime(dt.slice(11)),
                        close: h.close[i] ?? 0,
                        volume: h.volume[i] ?? 0,
                        tick_type: h.tick_type[i] ?? 0,
                    });
                }
                // live rows may already have arrived — keep them on top
                setRows((live) => [...live, ...hist].slice(0, MAX_ROWS));
            })
            .catch(() => undefined)
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        const off = onAnyTick((tick) => {
            if (tick.code !== contract.code) return;
            setRows((prev) =>
                [
                    {
                        time: fmtTickTime(tick.time),
                        close: tick.close,
                        volume: tick.volume,
                        tick_type: tick.tick_type,
                    },
                    ...prev,
                ].slice(0, MAX_ROWS),
            );
        });
        return () => {
            cancelled = true;
            off();
        };
    }, [contract]);

    return (
        <div className={panel.panelBody}>
            <div className={styles.tape}>
                {rows.length === 0 && (
                    <span
                        className={styles.tapeRow}
                        style={{ justifyItems: 'center' }}
                    >
                        <span />
                        <span className={styles.time}>
                            {loading ? '載入歷史成交…' : '今日尚無成交'}
                        </span>
                        <span />
                    </span>
                )}
                {rows.map((t, i) => {
                    const dir =
                        t.tick_type === 1
                            ? 'up'
                            : t.tick_type === 2
                              ? 'down'
                              : 'flat';
                    return (
                        <div key={`${t.time}-${i}`} className={styles.tapeRow}>
                            <span className={styles.time}>{t.time}</span>
                            <span
                                className={panel.dirText[dir]}
                                style={{ textAlign: 'right' }}
                            >
                                {fmtPrice(t.close)}
                            </span>
                            <span className={styles.vol}>
                                {fmtInt(t.volume)}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
