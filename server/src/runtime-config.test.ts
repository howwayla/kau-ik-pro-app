import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrokerCreds } from './config.ts';
import { RuntimeConfigStore } from './runtime-config.ts';

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
    apiUrl: 'https://broker.example.test',
};

function tempConfigPath() {
    return join(mkdtempSync(join(tmpdir(), 'kau-ik-runtime-config-')), 'config.json');
}

await check('loads legacy brokerCreds and exposes derived broker metadata', () => {
    const filePath = tempConfigPath();
    writeFileSync(
        filePath,
        JSON.stringify({
            marketProvider: 'mock',
            tradeProvider: 'fubon',
            brokerCreds: { fubon: fubonCreds },
        }),
    );

    const store = new RuntimeConfigStore(filePath);
    const config = store.get();

    assert.deepEqual(config.brokerCreds.fubon, fubonCreds);
    assert.deepEqual(config.brokerMetadata.fubon, {
        certPath: '/private/certs/fubon.p12',
        apiUrl: 'https://broker.example.test',
    });
});

await check('writes broker metadata without plaintext secret fields', () => {
    const filePath = tempConfigPath();
    const store = new RuntimeConfigStore(filePath);

    store.set({
        tradeProvider: 'fubon',
        brokerCreds: { fubon: fubonCreds },
    });

    const persisted = JSON.parse(readFileSync(filePath, 'utf8'));

    assert.deepEqual(persisted.brokerMetadata.fubon, {
        certPath: '/private/certs/fubon.p12',
        apiUrl: 'https://broker.example.test',
    });
    assert.equal(Object.hasOwn(persisted, 'brokerCreds'), false);
    const persistedText = JSON.stringify(persisted);
    for (const value of [
        'A123456789',
        'account-pass',
        'api-key',
        'api-secret',
        'cert-pass',
    ]) {
        assert.equal(persistedText.includes(value), false, `${value} leaked`);
    }
});

await check('defaults tradeProvider to mock when not explicitly persisted', () => {
    const store = new RuntimeConfigStore(tempConfigPath());

    assert.equal(store.get().tradeProvider, 'mock');
});

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILING'}`);
process.exit(failures === 0 ? 0 : 1);
