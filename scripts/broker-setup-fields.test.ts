import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BrokerSetupForm } from '../src/lib/broker-secret-payload.ts';
import {
    brokerSetupSummary,
    emptyBrokerSetupForm,
    fieldsForBroker,
    validateBrokerSetupForm,
} from '../src/lib/broker-setup-fields.ts';

function filled(): BrokerSetupForm {
    return {
        idNo: 'A123456789',
        password: 'account-pass',
        apiKey: 'api-key',
        apiSecret: 'api-secret',
        certPath: '/private/certs/fubon.p12',
        certPass: 'cert-pass',
        apiUrl: '',
    };
}

test('fieldsForBroker returns fubon setup fields in order', () => {
    assert.deepEqual(
        fieldsForBroker('fubon').map((field) => field.key),
        ['idNo', 'password', 'apiKey', 'certPath', 'certPass'],
    );
});

test('fieldsForBroker returns nova setup fields in order', () => {
    assert.deepEqual(
        fieldsForBroker('nova').map((field) => field.key),
        ['idNo', 'password', 'certPath', 'certPass', 'apiUrl'],
    );
});

test('fieldsForBroker returns esun setup fields in order', () => {
    assert.deepEqual(
        fieldsForBroker('esun').map((field) => field.key),
        ['idNo', 'password', 'apiKey', 'apiSecret', 'certPath', 'certPass'],
    );
});

test('fieldsForBroker only returns text or password field types', () => {
    const brokers = ['fubon', 'nova', 'esun'] as const;
    const fieldTypes = brokers.flatMap((broker) =>
        fieldsForBroker(broker).map((field) => field.type),
    );

    assert.deepEqual([...new Set(fieldTypes)].sort(), ['password', 'text']);
});

test('fubon validation accepts password-only credentials', () => {
    const form = { ...filled(), apiKey: '', apiSecret: '' };

    assert.deepEqual(validateBrokerSetupForm('fubon', form), {});
});

test('fubon validation accepts apiKey-only credentials', () => {
    const form = { ...filled(), password: '', apiSecret: '' };

    assert.deepEqual(validateBrokerSetupForm('fubon', form), {});
});

test('fubon validation requires password or apiKey', () => {
    const form = { ...filled(), password: '', apiKey: '', apiSecret: '' };

    assert.deepEqual(validateBrokerSetupForm('fubon', form), {
        password: '請填登入密碼或 API Key',
    });
});

test('esun validation requires apiKey and apiSecret', () => {
    const form = { ...filled(), apiKey: '', apiSecret: '' };

    assert.deepEqual(validateBrokerSetupForm('esun', form), {
        apiKey: '請填 API Key',
        apiSecret: '請填 API Secret',
    });
});

test('nova validation requires cert path and cert password', () => {
    const form = { ...filled(), certPath: '', certPass: '' };

    assert.deepEqual(validateBrokerSetupForm('nova', form), {
        certPath: '請選擇憑證檔',
        certPass: '請填憑證密碼',
    });
});

test('brokerSetupSummary for esun excludes credential fields', () => {
    const summary = brokerSetupSummary('esun', filled());

    assert.deepEqual(summary, {
        brokerLabel: '玉山',
        accountLabel: '證券帳號',
        accountValue: '已填寫',
        certificatePath: '/private/certs/fubon.p12',
        certificateFileName: 'fubon.p12',
        apiUrl: '',
    });

    const json = JSON.stringify(summary);
    assert.equal(json.includes('account-pass'), false);
    assert.equal(json.includes('api-key'), false);
    assert.equal(json.includes('api-secret'), false);
    assert.equal(json.includes('cert-pass'), false);
    assert.equal(json.includes('A123456789'), false);
});

test('emptyBrokerSetupForm returns all setup keys with empty strings', () => {
    assert.deepEqual(emptyBrokerSetupForm(), {
        idNo: '',
        password: '',
        apiKey: '',
        apiSecret: '',
        certPath: '',
        certPass: '',
        apiUrl: '',
    });
});
