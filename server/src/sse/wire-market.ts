// server/src/sse/wire-market.ts — fan market-data events out to the SSE hub.

import type { MarketManager } from '../providers/manager.ts';
import type { SseHub } from './hub.ts';

/**
 * Bridge the market manager's live feed to the SSE fan-out.
 *
 * The hub caches the last quote frame per symbol and replays it to every
 * newly attached client (covers page reloads). Price bases differ between
 * market sources, and a WS-down broker feed emits nothing — so when the
 * source swaps, the pre-swap frames must be dropped or they would replay
 * forever as stale quotes.
 */
export function wireMarketToHub(market: MarketManager, hub: SseHub): void {
    market.onTick((channel, tick) => hub.broadcast(channel, tick));
    market.onBidAsk((channel, bidask) => hub.broadcast(channel, bidask));
    // fires after the swap completes (old source disposed, new one active),
    // so the just-swapped-out source can't refill the cache afterwards
    market.onSourceSwap(() => hub.clearQuoteCache());
}
