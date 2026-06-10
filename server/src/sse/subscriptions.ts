// server/src/sse/subscriptions.ts — refcounted quote-subscription registry.
// The frontend re-POSTs every subscription after an SSE reconnect, so
// subscribe must be idempotent per (code, quoteType).

import type {
    ContractKey,
    MarketDataProvider,
    StreamQuoteType,
} from '../providers/market-data.ts';

interface Entry {
    key: ContractKey;
    quote: StreamQuoteType;
}

export class SubscriptionRegistry {
    private entries = new Map<string, Entry>();

    constructor(private market: MarketDataProvider) {}

    private id(key: ContractKey, quote: StreamQuoteType): string {
        return `${key.code}:${quote}`;
    }

    async subscribe(key: ContractKey, quote: StreamQuoteType): Promise<void> {
        const id = this.id(key, quote);
        if (this.entries.has(id)) return; // idempotent replay
        this.entries.set(id, { key, quote });
        try {
            await this.market.subscribe(key, quote);
        } catch (err) {
            this.entries.delete(id);
            throw err;
        }
    }

    async unsubscribe(
        key: ContractKey,
        quote: StreamQuoteType,
    ): Promise<void> {
        const id = this.id(key, quote);
        if (!this.entries.delete(id)) return;
        await this.market.unsubscribe(key, quote);
    }

    count(): number {
        return this.entries.size;
    }
}
