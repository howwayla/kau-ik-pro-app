import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    brokerMetadataFromSetupForm,
    brokerSecretsFromSetupForm,
    type BrokerSetupForm,
} from '../src/lib/broker-secret-payload.ts';

const form: BrokerSetupForm = {
    idNo: 'A123456789',
    password: 'account-pass',
    apiKey: 'api-key',
    apiSecret: 'api-secret',
    certPath: '/private/certs/fubon.p12',
    certPass: 'cert-pass',
    apiUrl: 'https://broker.example.test',
};

test('brokerSecretsFromSetupForm excludes non-secret metadata fields', () => {
    const secrets = brokerSecretsFromSetupForm(form);

    assert.deepEqual(secrets, {
        idNo: 'A123456789',
        password: 'account-pass',
        apiKey: 'api-key',
        apiSecret: 'api-secret',
        certPass: 'cert-pass',
    });
    assert.equal(Object.hasOwn(secrets, 'certPath'), false);
    assert.equal(Object.hasOwn(secrets, 'apiUrl'), false);
});

test('brokerMetadataFromSetupForm contains only provider metadata', () => {
    assert.deepEqual(brokerMetadataFromSetupForm('fubon', form), {
        provider: 'fubon',
        cert_path: '/private/certs/fubon.p12',
        api_url: 'https://broker.example.test',
    });
});
