// src/components/vol-profile.tsx — 分價量表 + 內外盤比.
// 量底用官方 intraday/volumes（全日交易所級）；開啟面板後的新成交
// 再用 live tick 疊加。官方表沒有的來源（mock）fallback 回逐筆累計。

import { useEffect, useMemo, useState } from 'react';
import { fetchHistoryTicks, fetchVolumes } from '../lib/backend';
import { onAnyTick } from '../lib/stream';
import type { ContractBase } from '../lib/types/contract';
import { fmtInt, fmtPrice } from '../lib/utils/format';
import { dateStrOffset } from '../lib/utils/kbars';
import * as dock from './bottom-dock.css';
import * as panel from './panel.css';
import * as styles from './vol-profile.css';

interface Level {
    buy: number; // 外盤 (成交在賣方掛單價, tick_type 1 / volumeAtAsk)
    sell: number; // 內盤 (tick_type 2 / volumeAtBid)
    und: number; // 無法判定（集合競價等）— 不計入內外盤比
}

type Profile = Map<number, Level>;

function addTo(profile: Profile, price: number, vol: number, tickType: number) {
    const lv = profile.get(price) ?? { buy: 0, sell: 0, und: 0 };
    if (tickType === 1) lv.buy += vol;
    else if (tickType === 2) lv.sell += vol;
    else lv.und += vol;
    profile.set(price, lv);
}

/** tick 的成交時間（台北時間）→ epoch ms，用來過濾已含在底表的重放 tick */
function tickMs(date: string, time: string): number {
    const t = Date.parse(`${date}T${time.slice(0, 12)}+08:00`);
    return Number.isFinite(t) ? t : 0;
}

export function VolProfile({ contract }: { contract: ContractBase }) {
    const [version, setVersion] = useState(0);
    const [profile, setProfile] = useState<Profile>(new Map());
    const [loading, setLoading] = useState(true);
    // 期貨/選擇權：官方分價量(intraday/volumes)無內外盤欄位(volumeAtBid/Ask)，
    // 全部會落入 und → 內外盤比恆 50/50（誤導）。期權直接不顯示內外盤比。
    const isFop =
        contract.security_type === 'FUT' || contract.security_type === 'OPT';

    useEffect(() => {
        let cancelled = false;
        const prof: Profile = new Map();
        // 底表載入完成前（=0）live tick 全部跳過；之後只收「底表時點
        // 以後」的成交，避免 SSE 重放的最後一筆被重複累計
        let baseMs = 0;
        setProfile(prof);
        setLoading(true);

        const loadOfficial = async (): Promise<boolean> => {
            try {
                const vols = await fetchVolumes(contract);
                if (vols.length === 0) return false;
                for (const v of vols) {
                    prof.set(v.price, {
                        buy: v.at_ask,
                        sell: v.at_bid,
                        und: Math.max(0, v.volume - v.at_ask - v.at_bid),
                    });
                }
                return true;
            } catch {
                return false;
            }
        };

        // fallback：逐筆累計（官方表無資料的來源，如 mock）。
        // 注意逐筆 API 上限 1000 筆 — 涵蓋不保證全日
        const loadTicks = async () => {
            const dates = isFop
                ? [dateStrOffset(-1), dateStrOffset(0)]
                : [dateStrOffset(0)];
            for (const d of dates) {
                try {
                    const h = await fetchHistoryTicks(contract, d);
                    if (h.datetime.length > 0) {
                        for (let i = 0; i < h.close.length; i++) {
                            addTo(
                                prof,
                                h.close[i] ?? 0,
                                h.volume[i] ?? 0,
                                h.tick_type[i] ?? 0,
                            );
                        }
                        break;
                    }
                } catch {
                    // try next date
                }
            }
        };

        const load = async () => {
            const official = await loadOfficial();
            if (!official) await loadTicks();
            if (!cancelled) {
                baseMs = Date.now();
                setVersion((v) => v + 1);
                setLoading(false);
            }
        };
        void load();

        const off = onAnyTick((tick) => {
            if (tick.code !== contract.code) return;
            if (baseMs === 0 || tickMs(tick.date, tick.time) <= baseMs) {
                return; // 底表載入前/已含在底表的成交不重複累計
            }
            addTo(prof, Number(tick.close), tick.volume, tick.tick_type);
            setVersion((v) => v + 1);
        });
        return () => {
            cancelled = true;
            off();
        };
    }, [contract]);

    const { rows, maxTotal, buySum, sellSum } = useMemo(() => {
        const entries = [...profile.entries()]
            .filter(([p]) => p > 0)
            .sort((a, b) => b[0] - a[0]);
        let buySum = 0;
        let sellSum = 0;
        let maxTotal = 1;
        for (const [, lv] of entries) {
            buySum += lv.buy;
            sellSum += lv.sell;
            maxTotal = Math.max(maxTotal, lv.buy + lv.sell + lv.und);
        }
        // cap rows for readability — keep the highest-volume levels
        let rows = entries;
        if (rows.length > 40) {
            const keep = new Set(
                [...entries]
                    .sort(
                        (a, b) =>
                            b[1].buy +
                            b[1].sell +
                            b[1].und -
                            (a[1].buy + a[1].sell + a[1].und),
                    )
                    .slice(0, 40)
                    .map(([p]) => p),
            );
            rows = entries.filter(([p]) => keep.has(p));
        }
        return { rows, maxTotal, buySum, sellSum };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [profile, version]);

    // 內外盤比只計可判定的部分（集合競價等不灌水）
    const judged = buySum + sellSum;
    const buyPct = judged > 0 ? (buySum / judged) * 100 : 50;

    if (loading && rows.length === 0) {
        return <div className={dock.emptyState}>統計分價量中…</div>;
    }
    if (rows.length === 0) {
        return <div className={dock.emptyState}>今日尚無成交資料</div>;
    }

    return (
        <div className={styles.wrap}>
            {!isFop && (
                <div className={styles.ratioRow}>
                    <span className={panel.dirText.up}>
                        外盤 {buyPct.toFixed(1)}%
                    </span>
                    <div className={styles.ratioTrack}>
                        <div
                            className={styles.ratioBuy}
                            style={{ width: `${buyPct}%` }}
                        />
                    </div>
                    <span className={panel.dirText.down}>
                        內盤 {(100 - buyPct).toFixed(1)}%
                    </span>
                </div>
            )}
            <div className={styles.list}>
                {rows.map(([price, lv]) => {
                    const t = lv.buy + lv.sell + lv.und;
                    return (
                        <div key={price} className={styles.row}>
                            <span className={styles.price}>
                                {fmtPrice(price)}
                            </span>
                            <div className={styles.barTrack}>
                                <div
                                    className={styles.barBuy}
                                    style={{
                                        width: `${(lv.buy / maxTotal) * 100}%`,
                                    }}
                                />
                                <div
                                    className={styles.barSell}
                                    style={{
                                        width: `${(lv.sell / maxTotal) * 100}%`,
                                    }}
                                />
                                <div
                                    className={styles.barUnd}
                                    style={{
                                        width: `${(lv.und / maxTotal) * 100}%`,
                                    }}
                                />
                            </div>
                            <span className={styles.vol}>
                                {fmtInt(Math.round(t))}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
