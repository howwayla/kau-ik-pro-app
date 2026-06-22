import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    getPreviousBrokerMetadata,
    shouldRollbackSavedSecrets,
} from '../src/lib/broker-setup-flow.ts';

test('shouldRollbackSavedSecrets rolls back when previous secret state is unknown', () => {
    assert.equal(shouldRollbackSavedSecrets(null), true);
    assert.equal(shouldRollbackSavedSecrets(undefined), true);
    assert.equal(shouldRollbackSavedSecrets({ present: false }), true);
    assert.equal(shouldRollbackSavedSecrets({ present: true }), false);
});

test('getPreviousBrokerMetadata ignores transient config fetch failures', async () => {
    const metadata = await getPreviousBrokerMetadata(
        async () => {
            throw new Error('server busy');
        },
        'fubon',
    );

    assert.equal(metadata, undefined);
});

test('getPreviousBrokerMetadata returns existing broker metadata', async () => {
    const metadata = await getPreviousBrokerMetadata(
        async () => ({
            provider: 'mock',
            default_broker: null,
            creds: {
                fubon: { env: false, saved: true },
                nova: { env: false, saved: false },
                esun: { env: false, saved: false },
            },
            metadata: {
                fubon: {
                    cert_path: '/private/certs/fubon.p12',
                    api_url: 'https://broker.example.test',
                },
                nova: null,
                esun: null,
            },
        }),
        'fubon',
    );

    assert.deepEqual(metadata, {
        cert_path: '/private/certs/fubon.p12',
        api_url: 'https://broker.example.test',
    });
});
