import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
    legacyRuntimeConfigFiles,
    migrateRuntimeConfig,
} from './config-migration.ts';
import type { BrokerCreds } from './config.ts';

let failures = 0;
async function check(name: string, fn: () => Promise<void> | void) {
    try {
        await fn();
        console.log(`  ok   ${name}`);
    } catch (e) {
        failures++;
        console.log(`  FAIL ${name}`);
        console.log(`       ${e instanceof Error ? e.message : e}`);
    }
}

const fubonCreds: BrokerCreds = {
    idNo: 'A123456789',
    password: 'account-pass',
    apiKey: 'api-key',
    apiSecret: 'api-secret',
    certPath: '/private/certs/fubon.p12',
    certPass: 'cert-pass',
    apiUrl: '',
};

function tempRoot() {
    return mkdtempSync(join(tmpdir(), 'kau-ik-config-migration-'));
}

function writeJson(filePath: string, value: unknown) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(value, null, 2), { mode: 0o600 });
}

function readJson(filePath: string) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}

function assertOwnerOnlyMode(filePath: string) {
    if (process.platform === 'win32') return;
    assert.equal(statSync(filePath).mode & 0o777, 0o600);
}

await check('migrates broker metadata from legacy bundle-id config to canonical config', () => {
    const root = tempRoot();
    const target = join(root, 'Kau-ik Pro', 'config.json');
    const legacy = join(root, 'io.github.howwayla.kauikpro', 'config.json');
    writeJson(legacy, {
        tradeProvider: 'nova',
        defaultTradeBroker: 'nova',
        brokerMetadata: {
            fubon: { certPath: '/private/certs/fubon.p12', apiUrl: '' },
            nova: { certPath: '/private/certs/nova.p12', apiUrl: '' },
            esun: {
                certPath: '/private/certs/esun.p12',
                apiUrl: 'https://esun.example.test',
            },
        },
    });

    const result = migrateRuntimeConfig({
        targetFile: target,
        legacyFiles: [legacy],
    });

    assert.deepEqual(result, { migrated: true, sources: [legacy] });
    const migrated = readJson(target);
    assert.equal(migrated.tradeProvider, 'nova');
    assert.equal(migrated.defaultTradeBroker, 'nova');
    assert.deepEqual(migrated.brokerMetadata.fubon, {
        certPath: '/private/certs/fubon.p12',
        apiUrl: '',
    });
    assert.deepEqual(migrated.brokerMetadata.esun, {
        certPath: '/private/certs/esun.p12',
        apiUrl: 'https://esun.example.test',
    });
    assertOwnerOnlyMode(target);
});

await check('discovers legacy product-name configs from bundle-id app data dir', () => {
    const root = tempRoot();
    const target = join(root, 'io.github.howwayla.kauikpro', 'config.json');

    assert.deepEqual(migrateRuntimeConfig({
        targetFile: target,
    }).sources, []);
    assert.ok(
        legacyRuntimeConfigFiles(target).includes(
            join(root, 'Kau-ik Pro', 'config.json'),
        ),
    );
    assert.ok(
        legacyRuntimeConfigFiles(target).includes(
            join(root, 'Kau-ik Pro', 'server', 'config.json'),
        ),
    );
});

await check('derives metadata from legacy brokerCreds without persisting secrets', () => {
    const root = tempRoot();
    const target = join(root, 'Kau-ik Pro', 'config.json');
    const legacy = join(root, 'Kau-ik Pro', 'server', 'config.json');
    writeJson(legacy, {
        tradeProvider: 'fubon',
        brokerCreds: { fubon: fubonCreds },
    });

    migrateRuntimeConfig({ targetFile: target, legacyFiles: [legacy] });

    const persisted = readFileSync(target, 'utf8');
    const migrated = JSON.parse(persisted);
    assert.deepEqual(migrated.brokerMetadata.fubon, {
        certPath: '/private/certs/fubon.p12',
        apiUrl: '',
    });
    assert.equal(Object.hasOwn(migrated, 'brokerCreds'), false);
    for (const secret of [
        'A123456789',
        'account-pass',
        'api-key',
        'api-secret',
        'cert-pass',
    ]) {
        assert.equal(persisted.includes(secret), false, `${secret} leaked`);
    }
});

await check('scrubs legacy config files after deriving broker metadata', () => {
    const root = tempRoot();
    const target = join(root, 'Kau-ik Pro', 'config.json');
    const legacy = join(root, 'Kau-ik Pro', 'server', 'config.json');
    writeJson(legacy, {
        tradeProvider: 'fubon',
        brokerCreds: { fubon: fubonCreds },
        brokerMetadata: {},
    });

    migrateRuntimeConfig({ targetFile: target, legacyFiles: [legacy] });

    const legacyText = readFileSync(legacy, 'utf8');
    const scrubbedLegacy = JSON.parse(legacyText);
    assert.deepEqual(scrubbedLegacy.brokerMetadata.fubon, {
        certPath: '/private/certs/fubon.p12',
        apiUrl: '',
    });
    assert.equal(Object.hasOwn(scrubbedLegacy, 'brokerCreds'), false);
    for (const secret of [
        'A123456789',
        'account-pass',
        'api-key',
        'api-secret',
        'cert-pass',
    ]) {
        assert.equal(legacyText.includes(secret), false, `${secret} leaked`);
    }
});

await check('fills only missing metadata and does not overwrite canonical settings', () => {
    const root = tempRoot();
    const target = join(root, 'Kau-ik Pro', 'config.json');
    const legacy = join(root, 'io.github.howwayla.kauikpro', 'config.json');
    writeJson(target, {
        tradeProvider: 'mock',
        defaultTradeBroker: null,
        brokerMetadata: {
            fubon: { certPath: '/new/fubon.p12', apiUrl: '' },
        },
    });
    writeJson(legacy, {
        tradeProvider: 'nova',
        defaultTradeBroker: 'nova',
        brokerMetadata: {
            fubon: { certPath: '/old/fubon.p12', apiUrl: '' },
            nova: { certPath: '/old/nova.p12', apiUrl: '' },
        },
    });

    migrateRuntimeConfig({ targetFile: target, legacyFiles: [legacy] });

    const migrated = readJson(target);
    assert.equal(migrated.tradeProvider, 'mock');
    assert.equal(migrated.defaultTradeBroker, null);
    assert.deepEqual(migrated.brokerMetadata.fubon, {
        certPath: '/new/fubon.p12',
        apiUrl: '',
    });
    assert.deepEqual(migrated.brokerMetadata.nova, {
        certPath: '/old/nova.p12',
        apiUrl: '',
    });
});

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILING'}`);
process.exit(failures === 0 ? 0 : 1);
