import assert from 'node:assert/strict';
import {
    assembleBrokerCreds,
    splitBrokerCreds,
    type BrokerMetadata,
    type BrokerSecrets,
} from './broker-credential-parts.ts';
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

const fullCreds: BrokerCreds = {
    idNo: 'A123456789',
    password: 'account-pass',
    apiKey: 'api-key',
    apiSecret: 'api-secret',
    certPath: '/private/certs/fubon.p12',
    certPass: 'cert-pass',
    apiUrl: 'https://broker.example.test',
};

await check('splitBrokerCreds keeps only non-secret metadata in config shape', () => {
    const { metadata, secrets } = splitBrokerCreds(fullCreds);

    for (const key of [
        'idNo',
        'password',
        'apiKey',
        'apiSecret',
        'certPass',
    ]) {
        assert.equal(Object.hasOwn(metadata, key), false, `${key} leaked`);
    }
    assert.deepEqual(metadata, {
        certPath: '/private/certs/fubon.p12',
        apiUrl: 'https://broker.example.test',
    } satisfies BrokerMetadata);
    assert.deepEqual(secrets, {
        idNo: 'A123456789',
        password: 'account-pass',
        apiKey: 'api-key',
        apiSecret: 'api-secret',
        certPass: 'cert-pass',
    } satisfies BrokerSecrets);
});

await check('assembleBrokerCreds combines metadata and secrets for provider login', () => {
    const { metadata, secrets } = splitBrokerCreds(fullCreds);

    assert.deepEqual(assembleBrokerCreds(metadata, secrets), fullCreds);
});

await check('assembleBrokerCreds returns null when secrets are unavailable', () => {
    const { metadata } = splitBrokerCreds(fullCreds);

    assert.equal(assembleBrokerCreds(metadata, null), null);
});

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILING'}`);
process.exit(failures === 0 ? 0 : 1);
