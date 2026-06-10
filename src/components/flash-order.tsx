// src/components/flash-order.tsx — 閃電下單 price-ladder.
// Click the bid column to buy LMT at that price, ask column to sell —
// no confirmation, gated by the 啟用 arm toggle.

import { useEffect, useMemo, useState } from 'react';
import { useQuote } from '../hooks/use-stream';
import { notify, placeQuickOrder } from '../lib/trade';
import type { ContractInfo } from '../lib/types/contract';
import type { Action } from '../lib/types/order';
import { fmtInt, fmtPrice } from '../lib/utils/format';
import { roundToTick, stepPrice } from '../lib/utils/ticksize';
import * as styles from './flash-order.css';

const LEVELS = 14; // rows above + below center

export function FlashOrder({ contract }: { contract: ContractInfo }) {
    const quote = useQuote(contract.code);
    const [qty, setQty] = useState(1);
    const [armed, setArmed] = useState(false);
    const [center, setCenter] = useState<number | null>(null);
    const [busyPrice, setBusyPrice] = useState<number | null>(null);

    const last = quote?.tick
        ? Number(quote.tick.close)
        : contract.reference || null;

    // center on first price / symbol change
    useEffect(() => {
        setCenter(null);
        setArmed(false);
    }, [contract.code]);
    useEffect(() => {
        if (center === null && last !== null) {
            setCenter(roundToTick(contract, last));
        }
    }, [center, last, contract]);

    // volume lookup from 5-level book
    const book = useMemo(() => {
        const map = new Map<string, { bid?: number; ask?: number }>();
        const ba = quote?.bidask;
        if (ba) {
            ba.bid_price.forEach((p, i) => {
                const key = Number(p).toFixed(2);
                map.set(key, { ...map.get(key), bid: ba.bid_volume[i] });
            });
            ba.ask_price.forEach((p, i) => {
                const key = Number(p).toFixed(2);
                map.set(key, { ...map.get(key), ask: ba.ask_volume[i] });
            });
        }
        return map;
    }, [quote?.bidask]);

    const maxVol = useMemo(() => {
        let m = 1;
        for (const v of book.values()) {
            m = Math.max(m, v.bid ?? 0, v.ask ?? 0);
        }
        return m;
    }, [book]);

    const rows = useMemo(() => {
        if (center === null) return [];
        const out: number[] = [];
        for (let i = LEVELS; i >= -LEVELS; i--) {
            out.push(stepPrice(contract, center, i));
        }
        return out;
    }, [center, contract]);

    const send = async (action: Action, price: number) => {
        if (!armed || busyPrice !== null) return;
        setBusyPrice(price);
        try {
            const trade = await placeQuickOrder(contract, action, price, qty);
            notify({
                kind: 'ok',
                title: `⚡ ${action === 'Buy' ? '買進' : '賣出'}已送出`,
                body: `${contract.code} ${qty} @ ${fmtPrice(price)} (${trade.status.status})`,
            });
        } catch (e) {
            notify({
                kind: 'err',
                title: '⚡ 閃電下單失敗',
                body: e instanceof Error ? e.message : String(e),
            });
        } finally {
            setBusyPrice(null);
        }
    };

    const lastKey = last !== null ? last.toFixed(2) : '';

    return (
        <div className={styles.wrap}>
            <div className={styles.controls}>
                <span className={styles.qtyLabel}>量</span>
                <input
                    className={styles.qtyInput}
                    value={qty}
                    inputMode='numeric'
                    onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isInteger(v) && v >= 0) setQty(v);
                    }}
                />
                <button
                    className={styles.armBtn[armed ? 'on' : 'off']}
                    onClick={() => setArmed((a) => !a)}
                >
                    {armed ? '⚡ 已啟用 點價即下單' : '啟用閃電下單'}
                </button>
                <button
                    className={styles.recenterBtn}
                    onClick={() =>
                        last !== null &&
                        setCenter(roundToTick(contract, last))
                    }
                >
                    置中
                </button>
            </div>
            <div className={styles.ladder}>
                <div className={styles.headRow}>
                    <span>買 BUY</span>
                    <span>價格</span>
                    <span>賣 SELL</span>
                </div>
                {rows.map((price) => {
                    const key = price.toFixed(2);
                    const lv = book.get(key);
                    const isLast = key === lastKey;
                    return (
                        <div
                            key={key}
                            className={styles.row[isLast ? 'last' : 'normal']}
                        >
                            <div
                                className={`${styles.buyCell} ${armed ? '' : styles.disabledCell}`}
                                onClick={() => send('Buy', price)}
                                title={
                                    armed
                                        ? `限價買 ${fmtPrice(price)} x ${qty}`
                                        : '先啟用閃電下單'
                                }
                            >
                                {lv?.bid !== undefined && (
                                    <div
                                        className={styles.volBar}
                                        style={{
                                            right: 0,
                                            width: `${(lv.bid / maxVol) * 90}%`,
                                            background: 'currentcolor',
                                            opacity: 0.18,
                                        }}
                                    />
                                )}
                                <span className={styles.cellText}>
                                    {lv?.bid !== undefined
                                        ? fmtInt(lv.bid)
                                        : ''}
                                </span>
                            </div>
                            <div className={styles.priceCell}>
                                {fmtPrice(price)}
                            </div>
                            <div
                                className={`${styles.sellCell} ${armed ? '' : styles.disabledCell}`}
                                onClick={() => send('Sell', price)}
                                title={
                                    armed
                                        ? `賣出 LMT ${fmtPrice(price)} x ${qty}`
                                        : '先啟用閃電下單'
                                }
                            >
                                {lv?.ask !== undefined && (
                                    <div
                                        className={styles.volBar}
                                        style={{
                                            left: 0,
                                            width: `${(lv.ask / maxVol) * 90}%`,
                                            background: 'currentcolor',
                                            opacity: 0.18,
                                        }}
                                    />
                                )}
                                <span className={styles.cellText}>
                                    {lv?.ask !== undefined
                                        ? fmtInt(lv.ask)
                                        : ''}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className={styles.hint}>
                {armed
                    ? '點左欄=限價買、右欄=限價賣（無確認）'
                    : '安全鎖定中 — 點「啟用閃電下單」解鎖'}
            </div>
        </div>
    );
}
