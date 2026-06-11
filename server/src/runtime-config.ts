// server/src/runtime-config.ts — user-editable settings persisted to
// server/data/config.json (gitignored). Seeded from env on first run.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BrokerCreds, TradeProviderName } from './config.ts';

export interface RuntimeConfig {
    /** standalone market choice (broker modes carry their own market data) */
    marketProvider: 'mock' | 'fugle';
    fugleApiKey: string;
    tradeProvider: TradeProviderName;
    /** credentials saved from the dashboard switcher (gitignored file) */
    brokerCreds: Partial<Record<'fubon' | 'nova' | 'esun', BrokerCreds>>;
}

export class RuntimeConfigStore {
    private config: RuntimeConfig;

    constructor(
        private filePath: string,
        envSeed: { marketProvider?: string; fugleApiKey?: string } = {},
    ) {
        let loaded: Partial<RuntimeConfig> = {};
        try {
            loaded = JSON.parse(readFileSync(filePath, 'utf8'));
        } catch {
            // first run — use env seed
        }
        this.config = {
            marketProvider:
                loaded.marketProvider ??
                (envSeed.marketProvider === 'fugle' ? 'fugle' : 'mock'),
            fugleApiKey: loaded.fugleApiKey ?? envSeed.fugleApiKey ?? '',
            tradeProvider: loaded.tradeProvider ?? 'mock',
            brokerCreds: loaded.brokerCreds ?? {},
        };
    }

    get(): RuntimeConfig {
        return { ...this.config };
    }

    set(patch: Partial<RuntimeConfig>): void {
        this.config = { ...this.config, ...patch };
        mkdirSync(dirname(this.filePath), { recursive: true });
        // may hold broker credentials — owner-only
        writeFileSync(this.filePath, JSON.stringify(this.config, null, 2), {
            mode: 0o600,
        });
    }
}
