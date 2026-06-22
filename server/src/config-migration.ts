import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
    splitBrokerCreds,
    type BrokerMetadata,
} from './broker-credential-parts.ts';
import type { BrokerCreds, BrokerName, TradeProviderName } from './config.ts';

type BrokerKey = BrokerName;

interface RuntimeConfigJson {
    marketProvider?: 'mock' | 'fugle';
    fugleApiKey?: string;
    tradeProvider?: TradeProviderName;
    defaultTradeBroker?: BrokerKey | null;
    brokerMetadata?: Partial<Record<BrokerKey, Partial<BrokerMetadata>>>;
    brokerCreds?: Partial<Record<BrokerKey, BrokerCreds>>;
    [key: string]: unknown;
}

export interface RuntimeConfigMigrationResult {
    migrated: boolean;
    sources: string[];
}

export function legacyRuntimeConfigFiles(targetFile: string): string[] {
    const dataDir = dirname(targetFile);
    const supportDir = dirname(dataDir);
    const files: string[] = [];

    if (basename(dataDir) === 'Kau-ik Pro') {
        files.push(
            join(supportDir, 'io.github.howwayla.kauikpro', 'config.json'),
            join(dataDir, 'server', 'config.json'),
        );
    }

    return files.filter((file) => file !== targetFile);
}

export function migrateRuntimeConfig({
    targetFile,
    legacyFiles = legacyRuntimeConfigFiles(targetFile),
}: {
    targetFile: string;
    legacyFiles?: string[];
}): RuntimeConfigMigrationResult {
    const target = readConfig(targetFile) ?? {};
    const next: RuntimeConfigJson = { ...target };
    delete next.brokerCreds;

    const mergedMetadata = extractBrokerMetadata(target);
    const sources: string[] = [];

    for (const legacyFile of legacyFiles) {
        const legacy = readConfig(legacyFile);
        if (!legacy) continue;

        let used = false;
        const legacyMetadata = extractBrokerMetadata(legacy);
        for (const broker of ['fubon', 'nova', 'esun'] as const) {
            if (
                !hasBrokerMetadata(mergedMetadata[broker]) &&
                hasBrokerMetadata(legacyMetadata[broker])
            ) {
                mergedMetadata[broker] = legacyMetadata[broker];
                used = true;
            }
        }

        if (next.tradeProvider === undefined && isTradeProvider(legacy.tradeProvider)) {
            next.tradeProvider = legacy.tradeProvider;
            used = true;
        }
        if (
            next.defaultTradeBroker === undefined &&
            isDefaultBroker(legacy.defaultTradeBroker)
        ) {
            next.defaultTradeBroker = legacy.defaultTradeBroker;
            used = true;
        }
        if (next.marketProvider === undefined && isMarketProvider(legacy.marketProvider)) {
            next.marketProvider = legacy.marketProvider;
            used = true;
        }
        if (next.fugleApiKey === undefined && typeof legacy.fugleApiKey === 'string') {
            next.fugleApiKey = legacy.fugleApiKey;
            used = true;
        }

        scrubRuntimeConfigFile(legacyFile, legacy, legacyMetadata);
        if (used) sources.push(legacyFile);
    }

    if (Object.keys(mergedMetadata).length > 0) {
        next.brokerMetadata = mergedMetadata;
    }

    if (sources.length === 0 && JSON.stringify(next) === JSON.stringify(target)) {
        return { migrated: false, sources: [] };
    }

    mkdirSync(dirname(targetFile), { recursive: true });
    writeFileSync(targetFile, JSON.stringify(next, null, 2), { mode: 0o600 });
    return { migrated: sources.length > 0, sources };
}

function scrubRuntimeConfigFile(
    filePath: string,
    config: RuntimeConfigJson,
    metadata: Partial<Record<BrokerKey, BrokerMetadata>>,
): void {
    if (!config.brokerCreds) return;

    const next: RuntimeConfigJson = { ...config };
    delete next.brokerCreds;
    if (Object.keys(metadata).length > 0) {
        next.brokerMetadata = {
            ...(next.brokerMetadata ?? {}),
            ...metadata,
        };
    }
    writeFileSync(filePath, JSON.stringify(next, null, 2), { mode: 0o600 });
}

function readConfig(filePath: string): RuntimeConfigJson | null {
    if (!existsSync(filePath)) return null;
    try {
        return JSON.parse(readFileSync(filePath, 'utf8')) as RuntimeConfigJson;
    } catch {
        return null;
    }
}

function extractBrokerMetadata(
    config: RuntimeConfigJson,
): Partial<Record<BrokerKey, BrokerMetadata>> {
    const metadata: Partial<Record<BrokerKey, BrokerMetadata>> = {};
    for (const broker of ['fubon', 'nova', 'esun'] as const) {
        const direct = normalizeBrokerMetadata(config.brokerMetadata?.[broker]);
        if (hasBrokerMetadata(direct)) {
            metadata[broker] = direct;
            continue;
        }

        const creds = config.brokerCreds?.[broker];
        if (creds) metadata[broker] = splitBrokerCreds(creds).metadata;
    }
    return metadata;
}

function normalizeBrokerMetadata(
    metadata:
        | Partial<BrokerMetadata>
        | { cert_path?: string; api_url?: string }
        | undefined,
): BrokerMetadata | undefined {
    if (!metadata) return undefined;
    const legacy = metadata as { cert_path?: string; api_url?: string };
    return {
        certPath: (metadata as Partial<BrokerMetadata>).certPath ?? legacy.cert_path ?? '',
        apiUrl: (metadata as Partial<BrokerMetadata>).apiUrl ?? legacy.api_url ?? '',
    };
}

function hasBrokerMetadata(
    metadata: Partial<BrokerMetadata> | undefined,
): metadata is BrokerMetadata {
    return Boolean(metadata?.certPath || metadata?.apiUrl);
}

function isTradeProvider(value: unknown): value is TradeProviderName {
    return (
        value === 'mock' ||
        value === 'fubon' ||
        value === 'nova' ||
        value === 'esun'
    );
}

function isDefaultBroker(value: unknown): value is BrokerKey | null {
    return value === null || value === 'fubon' || value === 'nova' || value === 'esun';
}

function isMarketProvider(value: unknown): value is 'mock' | 'fugle' {
    return value === 'mock' || value === 'fugle';
}
