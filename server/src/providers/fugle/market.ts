// server/src/providers/fugle/market.ts — Fugle marketdata provider (Phase 2).
//
// Status: stub. The real implementation (per the approved plan) will:
//  - use the official `@fugle/marketdata` Node SDK with FUGLE_API_KEY
//  - serve snapshots from a server-side WebSocket quote cache (trades +
//    books channels) to stay inside REST rate limits
//  - map symbols: '001' ↔ 'IX0001'; resolve 'TXFR1' → front-month TXF via
//    futopt intraday tickers and emit ticks under the resolved code
//  - downshift kbars timeframe by range (1m → 5m → D); the frontend
//    aggregator is bucket-floor based so coarser bars stay correct
//  - return empty HistoryTicks for past dates (intraday trades only)
//  - scanner: movers → ChangePercentRank, actives → Volume/AmountRank
//  - build the TXO chain from futopt intraday tickers (type=OPTION)

import type { Config } from '../../config.ts';
import type { MarketDataProvider } from '../market-data.ts';

export class FugleMarketDataProvider implements Partial<MarketDataProvider> {
    constructor(private config: Config) {}

    async init(): Promise<void> {
        if (!this.config.fugleApiKey) {
            throw new Error('MARKET_PROVIDER=fugle 需要 FUGLE_API_KEY');
        }
        throw new Error(
            'Fugle 行情 provider 尚未實作（Phase 2）— 目前請使用 MARKET_PROVIDER=mock',
        );
    }
}
