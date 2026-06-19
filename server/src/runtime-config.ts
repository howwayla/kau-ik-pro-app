// server/src/runtime-config.ts — user-editable settings persisted to
// server/data/config.json (gitignored). Seeded from env on first run.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
    splitBrokerCreds,
    type BrokerMetadata,
} from './broker-credential-parts.ts';
import type { BrokerCreds, TradeProviderName } from './config.ts';

type BrokerKey = 'fubon' | 'nova' | 'esun';

export interface RuntimeConfig {
    /** standalone market choice (broker modes carry their own market data) */
    marketProvider: 'mock' | 'fugle';
    fugleApiKey: string;
    tradeProvider: TradeProviderName;
    defaultTradeBroker: BrokerKey | null;
    /** non-secret broker setup metadata persisted to config.json */
    brokerMetadata: Partial<Record<BrokerKey, BrokerMetadata>>;
    /** legacy/plaintext credentials kept in memory only for migration */
    brokerCreds: Partial<Record<BrokerKey, BrokerCreds>>;
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
        const legacyCreds = loaded.brokerCreds ?? {};
        this.config = {
            marketProvider:
                loaded.marketProvider ??
                (envSeed.marketProvider === 'fugle' ? 'fugle' : 'mock'),
            fugleApiKey: loaded.fugleApiKey ?? envSeed.fugleApiKey ?? '',
            tradeProvider: loaded.tradeProvider ?? 'mock',
            defaultTradeBroker:
                loaded.defaultTradeBroker === 'fubon' ||
                loaded.defaultTradeBroker === 'nova' ||
                loaded.defaultTradeBroker === 'esun'
                    ? loaded.defaultTradeBroker
                    : null,
            brokerMetadata:
                loaded.brokerMetadata ?? deriveBrokerMetadata(legacyCreds),
            brokerCreds: legacyCreds,
        };
    }

    get(): RuntimeConfig {
        return { ...this.config };
    }

    set(patch: Partial<RuntimeConfig>): void {
        const brokerMetadata = {
            ...this.config.brokerMetadata,
            ...deriveBrokerMetadata(patch.brokerCreds),
            ...patch.brokerMetadata,
        };
        this.config = { ...this.config, ...patch, brokerMetadata };
        mkdirSync(dirname(this.filePath), { recursive: true });
        writeFileSync(
            this.filePath,
            JSON.stringify(persistedConfig(this.config), null, 2),
            {
                mode: 0o600,
            },
        );
    }
}

function deriveBrokerMetadata(
    brokerCreds: Partial<Record<BrokerKey, BrokerCreds>> | undefined,
): Partial<Record<BrokerKey, BrokerMetadata>> {
    const metadata: Partial<Record<BrokerKey, BrokerMetadata>> = {};
    for (const broker of ['fubon', 'nova', 'esun'] as const) {
        const creds = brokerCreds?.[broker];
        if (creds) metadata[broker] = splitBrokerCreds(creds).metadata;
    }
    return metadata;
}

function persistedConfig(config: RuntimeConfig) {
    return {
        marketProvider: config.marketProvider,
        fugleApiKey: config.fugleApiKey,
        tradeProvider: config.tradeProvider,
        defaultTradeBroker: config.defaultTradeBroker,
        brokerMetadata: config.brokerMetadata,
    };
}
