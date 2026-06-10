// src/components/depth-map.tsx — 委託簿熱圖: time-series canvas heatmap of
// the 5-level book. X = time, Y = price, intensity = resting volume; shows
// where order walls build up and get pulled.

import { useEffect, useRef } from 'react';
import { subscribeQuoteStore, getQuote } from '../lib/stream';
import { getChartColors, useThemeSettings } from '../lib/theme-store';
import type { ContractBase } from '../lib/types/contract';
import * as styles from './depth-map.css';

interface Column {
    bids: { price: number; vol: number }[];
    asks: { price: number; vol: number }[];
    last: number | null;
}

const MAX_COLS = 360; // ~ minutes of book history at 1 col/update batch

export function DepthMap({ contract }: { contract: ContractBase }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const colsRef = useRef<Column[]>([]);
    const themeSettings = useThemeSettings();
    const themeRef = useRef(themeSettings);
    themeRef.current = themeSettings;

    useEffect(() => {
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

            const colW = Math.max(1, w / MAX_COLS);
            const yOf = (p: number) => h - ((p - min) / (max - min)) * h;
            const colors = getChartColors(themeRef.current);

            const cellH = Math.max(
                2,
                h / Math.max(20, (max - min) / ((max - min) / 60)),
            );
            cols.forEach((c, i) => {
                const x = w - (cols.length - i) * colW;
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
                colsRef.current.splice(
                    0,
                    colsRef.current.length - MAX_COLS,
                );
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

    return (
        <div className={styles.wrap}>
            <canvas ref={canvasRef} className={styles.canvas} />
            <span className={styles.hint}>
                即時累積五檔掛單熱圖 — 越亮代表掛單越厚（開啟後開始記錄）
            </span>
        </div>
    );
}
