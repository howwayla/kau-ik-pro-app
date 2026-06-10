// src/components/depth-ladder.tsx — 5-level bid/ask "energy bars".
// Clicking a price loads it into the order ticket.

import { useQuote } from '../hooks/use-stream';
import { setPickedPrice } from '../lib/price-sync';
import { fmtInt, fmtPrice } from '../lib/utils/format';
import * as panel from './panel.css';
import * as styles from './depth-ladder.css';

export function DepthLadder({ code }: { code: string }) {
    const onPickPrice = (price: number) => setPickedPrice(code, price);
    const quote = useQuote(code);
    const ba = quote?.bidask;

    const bids = (ba?.bid_price ?? []).map((p, i) => ({
        price: Number(p),
        vol: ba?.bid_volume[i] ?? 0,
    }));
    const asks = (ba?.ask_price ?? []).map((p, i) => ({
        price: Number(p),
        vol: ba?.ask_volume[i] ?? 0,
    }));
    const maxVol = Math.max(
        1,
        ...bids.map((b) => b.vol),
        ...asks.map((a) => a.vol),
    );
    const totalBid = bids.reduce((s, b) => s + b.vol, 0);
    const totalAsk = asks.reduce((s, a) => s + a.vol, 0);

    return (
        <div className={styles.grid}>
                <div className={styles.headerRow}>
                    <span>買量</span>
                    <span style={{ textAlign: 'right' }}>BID</span>
                    <span>ASK</span>
                    <span style={{ textAlign: 'right' }}>賣量</span>
                </div>
                {[0, 1, 2, 3, 4].map((i) => {
                    const bid = bids[i];
                    const ask = asks[i];
                    return (
                        <div key={i} className={styles.ladderRow}>
                            <span className={styles.volText}>
                                {bid ? fmtInt(bid.vol) : ''}
                            </span>
                            <div
                                className={styles.barTrack}
                                onClick={() =>
                                    bid?.price && onPickPrice(bid.price)
                                }
                            >
                                <div
                                    className={styles.bidBar}
                                    style={{
                                        width: `${((bid?.vol ?? 0) / maxVol) * 100}%`,
                                    }}
                                />
                                <span className={styles.priceBid}>
                                    {bid?.price ? fmtPrice(bid.price) : ''}
                                </span>
                            </div>
                            <div
                                className={styles.barTrack}
                                onClick={() =>
                                    ask?.price && onPickPrice(ask.price)
                                }
                            >
                                <div
                                    className={styles.askBar}
                                    style={{
                                        width: `${((ask?.vol ?? 0) / maxVol) * 100}%`,
                                    }}
                                />
                                <span className={styles.priceAsk}>
                                    {ask?.price ? fmtPrice(ask.price) : ''}
                                </span>
                            </div>
                            <span className={styles.volTextRight}>
                                {ask ? fmtInt(ask.vol) : ''}
                            </span>
                        </div>
                    );
                })}
            <div className={styles.totals}>
                <span>Σ買 {fmtInt(totalBid)}</span>
                <span>Σ賣 {fmtInt(totalAsk)}</span>
            </div>
        </div>
    );
}
