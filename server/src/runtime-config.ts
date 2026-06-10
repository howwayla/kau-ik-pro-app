// server/src/runtime-config.ts — user-editable settings persisted to
// server/data/config.json (gitignored). Seeded from env on first run.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MarketName } from './providers/manager.ts';

export interface RuntimeConfig {
    marketProvider: MarketName;
    fugleApiKey: string;
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
        };
    }

    get(): RuntimeConfig {
        return { ...this.config };
    }

    set(patch: Partial<RuntimeConfig>): void {
        this.config = { ...this.config, ...patch };
        mkdirSync(dirname(this.filePath), { recursive: true });
        writeFileSync(this.filePath, JSON.stringify(this.config, null, 2));
    }
}
