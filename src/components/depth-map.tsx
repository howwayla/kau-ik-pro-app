// src/components/depth-map.tsx — 委託簿熱圖: time-series canvas heatmap of
// the 5-level book. X = time, Y = price, intensity = resting volume; shows
// where order walls build up and get pulled. A right-edge price axis and a
// hover readout make the wall prices legible.

import { useEffect, useRef, useState } from 'react';
import { ensureStream, subscribeQuoteStore, getQuote } from '../lib/stream';
import { getChartColors, useThemeSettings } from '../lib/theme-store';
import type { ContractBase } from '../lib/types/contract';
import { fmtInt, fmtPrice } from '../lib/utils/format';
import * as styles from './depth-map.css';

interface Column {
    bids: { price: number; vol: number }[];
    asks: { price: number; vol: number }[];
    last: number | null;
}

const MAX_COLS = 360; // ~ minutes of book history at 1 col/update batch
const AXIS_W = 52; // right gutter reserved for price labels

export function DepthMap({ contract }: { contract: ContractBase }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const colsRef = useRef<Column[]>([]);
    const themeSettings = useThemeSettings();
    const themeRef = useRef(themeSettings);
    themeRef.current = themeSettings;

    // geometry from the last paint, so the hover handler can invert y → price
    const geomRef = useRef({ min: 0, max: 0, plotH: 0 });
    const [hover, setHover] = useState<{
        y: number;
        price: number;
        bidVol: number;
        askVol: number;
    } | null>(null);

    useEffect(() => {
        // 此面板直接讀 quote store，不經 useQuote — 必須自己確保 SSE 已啟動
        // （獨立彈出視窗時沒有其他元件會啟動它）
        ensureStream();
        colsRef.current = [];
        let raf = 0;
        let dirty = false;

        const draw = () => {
            raf = 0;
            if (!dirty) return;
            dirty = false;
            const canvas = canvasRef.current;
            if (!canvas) return;
            const dpr = window.devicePixelRatio || 1;
            const w = canvas.clientWidth;
            const h = canvas.clientHeight;
            if (w === 0 || h === 0) return;
            if (canvas.width !== w * dpr) canvas.width = w * dpr;
            if (canvas.height !== h * dpr) canvas.height = h * dpr;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);

            const cols = colsRef.current;
            if (cols.length === 0) return;

            // price range over the buffer
            let min = Infinity;
            let max = -Infinity;
            let maxVol = 1;
            for (const c of cols) {
                for (const lv of [...c.bids, ...c.asks]) {
                    if (lv.price <= 0) continue;
                    min = Math.min(min, lv.price);
                    max = Math.max(max, lv.price);
                    maxVol = Math.max(maxVol, lv.vol);
                }
            }
            if (!Number.isFinite(min) || max <= min) return;
            const pad = (max - min) * 0.05;
            min -= pad;
            max += pad;

            const plotW = w - AXIS_W; // leave room for the price axis
            const colW = Math.max(1, plotW / MAX_COLS);
            const yOf = (p: number) => h - ((p - min) / (max - min)) * h;
            const colors = getChartColors(themeRef.current);
            geomRef.current = { min, max, plotH: h };

            const cellH = Math.max(
                2,
                h / Math.max(20, (max - min) / ((max - min) / 60)),
            );
            cols.forEach((c, i) => {
                const x = plotW - (cols.length - i) * colW;
                if (x + colW < 0) return;
                for (const [levels, color] of [
                    [c.bids, colors.up],
                    [c.asks, colors.down],
                ] as const) {
                    for (const lv of levels) {
                        if (lv.price <= 0) continue;
                        const alpha = Math.min(
                            0.85,
                            0.12 + (lv.vol / maxVol) * 0.75,
                        );
                        ctx.globalAlpha = alpha;
                        ctx.fillStyle = color;
                        ctx.fillRect(
                            x,
                            yOf(lv.price) - cellH / 2,
                            colW + 0.5,
                            cellH,
                        );
                    }
                }
                if (c.last !== null) {
                    ctx.globalAlpha = 0.9;
                    ctx.fillStyle = colors.text;
                    ctx.fillRect(x, yOf(c.last) - 0.5, colW + 0.5, 1);
                }
            });
            ctx.globalAlpha = 1;

            // ---- price axis (right gutter) ----
            const last = cols[cols.length - 1]?.last ?? null;
            ctx.font = '10px "JetBrains Mono", monospace';
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'right';
            const TICKS = 6;
            for (let t = 0; t <= TICKS; t++) {
                const price = min + ((max - min) * t) / TICKS;
                const y = yOf(price);
                ctx.globalAlpha = 0.16;
                ctx.strokeStyle = colors.text;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(plotW, y);
                ctx.stroke();
                ctx.globalAlpha = 0.7;
                ctx.fillStyle = colors.text;
                ctx.fillText(fmtPrice(price), w - 4, y);
            }
            // emphasise the latest traded price
            if (last !== null && last > 0) {
                const y = yOf(last);
                ctx.globalAlpha = 1;
                ctx.fillStyle = colors.text;
                ctx.fillRect(plotW, y - 7, AXIS_W, 14);
                ctx.fillStyle =
                    themeRef.current.mode === 'dark' ? '#0c0f16' : '#fff';
                ctx.fillText(fmtPrice(last), w - 4, y);
            }
            ctx.globalAlpha = 1;
        };

        const schedule = () => {
            dirty = true;
            if (!raf) raf = requestAnimationFrame(draw);
        };

        const off = subscribeQuoteStore(contract.code, () => {
            const q = getQuote(contract.code);
            const ba = q?.bidask;
            if (!ba) return;
            colsRef.current.push({
                bids: ba.bid_price.map((p, i) => ({
                    price: Number(p),
                    vol: ba.bid_volume[i] ?? 0,
                })),
                asks: ba.ask_price.map((p, i) => ({
                    price: Number(p),
                    vol: ba.ask_volume[i] ?? 0,
                })),
                last: q?.tick ? Number(q.tick.close) : null,
            });
            if (colsRef.current.length > MAX_COLS) {
                colsRef.current.splice(0, colsRef.current.length - MAX_COLS);
            }
            schedule();
        });

        const resize = new ResizeObserver(schedule);
        if (canvasRef.current) resize.observe(canvasRef.current);
        return () => {
            off();
            resize.disconnect();
            if (raf) cancelAnimationFrame(raf);
        };
    }, [contract.code]);

    // hover → price at cursor row + the volume resting at that price in the
    // latest book column
    const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        const g = geomRef.current;
        if (!canvas || g.max <= g.min) return;
        const rect = canvas.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const price = g.min + (1 - y / g.plotH) * (g.max - g.min);
        const tol = ((g.max - g.min) / g.plotH) * 6; // ±6px in price units
        const latest = colsRef.current[colsRef.current.length - 1];
        let bidVol = 0;
        let askVol = 0;
        if (latest) {
            for (const lv of latest.bids) {
                if (Math.abs(lv.price - price) <= tol) bidVol += lv.vol;
            }
            for (const lv of latest.asks) {
                if (Math.abs(lv.price - price) <= tol) askVol += lv.vol;
            }
        }
        setHover({ y, price, bidVol, askVol });
    };

    return (
        <div className={styles.wrap}>
            <div className={styles.plot}>
                <canvas
                    ref={canvasRef}
                    className={styles.canvas}
                    onMouseMove={onMove}
                    onMouseLeave={() => setHover(null)}
                />
                {hover && (
                    <div
                        className={styles.readout}
                        style={{ top: Math.max(0, hover.y - 10) }}
                    >
                        <span className={styles.readoutPrice}>
                            {fmtPrice(hover.price)}
                        </span>
                        {hover.askVol > 0 && (
                            <span className={styles.readoutAsk}>
                                賣 {fmtInt(hover.askVol)}
                            </span>
                        )}
                        {hover.bidVol > 0 && (
                            <span className={styles.readoutBid}>
                                買 {fmtInt(hover.bidVol)}
                            </span>
                        )}
                    </div>
                )}
            </div>
            <span className={styles.hint}>
                即時累積五檔掛單熱圖 — 右側價格軸，移游標看該價掛單量（開啟後開始記錄）
            </span>
        </div>
    );
}
