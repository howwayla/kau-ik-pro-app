// src/components/replay-panel.tsx — 行情回放: replay today's ticks at
// adjustable speed on a self-contained line chart (great for練盤感 in sim).

import {
    ColorType,
    createChart,
    LineSeries,
    type IChartApi,
    type ISeriesApi,
    type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { fetchHistoryTicks } from '../lib/shioaji';
import { getChartColors, useThemeSettings } from '../lib/theme-store';
import type { ContractBase } from '../lib/types/contract';
import { fmtInt, fmtPrice } from '../lib/utils/format';
import { dateStrOffset, wallClockToUtc } from '../lib/utils/kbars';
import * as dock from './bottom-dock.css';
import * as styles from './replay-panel.css';

interface ReplayTick {
    time: number;
    price: number;
    volume: number;
}

const SPEEDS = [
    { label: '1x', tps: 10 },
    { label: '5x', tps: 50 },
    { label: '20x', tps: 200 },
    { label: '100x', tps: 1000 },
];

export function ReplayPanel({ contract }: { contract: ContractBase }) {
    const hostRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
    const ticksRef = useRef<ReplayTick[]>([]);
    const idxRef = useRef(0);
    const [loaded, setLoaded] = useState(false);
    const [empty, setEmpty] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [speedIdx, setSpeedIdx] = useState(1);
    const [, force] = useState(0);
    const themeSettings = useThemeSettings();

    // chart lifecycle
    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const c = getChartColors(themeSettings);
        const chart = createChart(host, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: c.text,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                attributionLogo: false,
            },
            grid: {
                vertLines: { color: c.grid },
                horzLines: { color: c.grid },
            },
            rightPriceScale: { borderColor: c.border },
            timeScale: {
                borderColor: c.border,
                timeVisible: true,
                secondsVisible: true,
            },
            autoSize: true,
        });
        const series = chart.addSeries(LineSeries, {
            color: c.crosshair,
            lineWidth: 1,
        });
        chartRef.current = chart;
        seriesRef.current = series;
        return () => {
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [`${themeSettings.mode}`]);

    // load ticks
    useEffect(() => {
        let cancelled = false;
        setLoaded(false);
        setEmpty(false);
        setPlaying(false);
        idxRef.current = 0;
        ticksRef.current = [];
        const isFop =
            contract.security_type === 'FUT' ||
            contract.security_type === 'OPT';
        (async () => {
            const dates = isFop
                ? [dateStrOffset(-1), dateStrOffset(0)]
                : [dateStrOffset(0)];
            for (const d of dates) {
                try {
                    const h = await fetchHistoryTicks(contract, d);
                    if (h.datetime.length > 0) {
                        const ticks: ReplayTick[] = [];
                        for (let i = 0; i < h.datetime.length; i++) {
                            const dt = h.datetime[i];
                            if (!dt) continue;
                            ticks.push({
                                time: wallClockToUtc(dt),
                                price: h.close[i] ?? 0,
                                volume: h.volume[i] ?? 0,
                            });
                        }
                        if (!cancelled) {
                            ticksRef.current = ticks;
                            seriesRef.current?.setData([]);
                            setLoaded(true);
                        }
                        return;
                    }
                } catch {
                    // try next date
                }
            }
            if (!cancelled) setEmpty(true);
        })();
        return () => {
            cancelled = true;
        };
    }, [contract]);

    // playback loop
    useEffect(() => {
        if (!playing) return;
        const tps = SPEEDS[speedIdx]?.tps ?? 50;
        const interval = setInterval(() => {
            const ticks = ticksRef.current;
            const series = seriesRef.current;
            if (!series) return;
            const batch = Math.max(1, Math.round(tps / 20));
            let lastTime = -1;
            for (let n = 0; n < batch; n++) {
                const t = ticks[idxRef.current];
                if (!t) {
                    setPlaying(false);
                    break;
                }
                // lightweight-charts requires strictly increasing times
                if (t.time > lastTime) {
                    series.update({
                        time: t.time as UTCTimestamp,
                        value: t.price,
                    });
                    lastTime = t.time;
                }
                idxRef.current += 1;
            }
            force((v) => v + 1);
        }, 50);
        return () => clearInterval(interval);
    }, [playing, speedIdx]);

    const seek = (idx: number) => {
        const ticks = ticksRef.current;
        const series = seriesRef.current;
        if (!series) return;
        idxRef.current = idx;
        const seen = new Map<number, number>();
        for (let i = 0; i < idx; i++) {
            const t = ticks[i];
            if (t) seen.set(t.time, t.price);
        }
        series.setData(
            [...seen.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([time, value]) => ({
                    time: time as UTCTimestamp,
                    value,
                })),
        );
        force((v) => v + 1);
    };

    const ticks = ticksRef.current;
    const idx = idxRef.current;
    const cur = ticks[Math.max(0, idx - 1)];

    if (empty) {
        return <div className={dock.emptyState}>無可回放的歷史成交</div>;
    }

    return (
        <div className={styles.wrap}>
            <div className={styles.controls}>
                <button
                    className={styles.playBtn}
                    disabled={!loaded}
                    onClick={() => {
                        if (idx >= ticks.length) seek(0);
                        setPlaying((p) => !p);
                    }}
                >
                    {playing ? '⏸ 暫停' : '▶ 播放'}
                </button>
                {SPEEDS.map((sp, i) => (
                    <button
                        key={sp.label}
                        className={styles.speed[i === speedIdx ? 'on' : 'off']}
                        onClick={() => setSpeedIdx(i)}
                    >
                        {sp.label}
                    </button>
                ))}
                <input
                    type='range'
                    className={styles.seek}
                    min={0}
                    max={ticks.length}
                    value={idx}
                    onChange={(e) => seek(Number(e.target.value))}
                />
                <span className={styles.status}>
                    {loaded
                        ? cur
                            ? `${fmtPrice(cur.price)} · ${fmtInt(idx)}/${fmtInt(ticks.length)}`
                            : `${fmtInt(ticks.length)} ticks`
                        : '載入中…'}
                </span>
            </div>
            <div ref={hostRef} className={styles.chartHost} />
        </div>
    );
}
