import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BrokerSetupForm } from '../src/lib/broker-secret-payload.ts';
import {
    applyEsunConfigToForm,
    parseEsunConfigIni,
} from '../src/lib/esun-config-import.ts';

const baseForm: BrokerSetupForm = {
    idNo: '',
    password: 'login-password',
    apiKey: '',
    apiSecret: '',
    certPath: '',
    certPass: 'cert-password',
    apiUrl: '',
};

test('parseEsunConfigIni reads the official ini sections', () => {
    const parsed = parseEsunConfigIni(`
        [Core]
        Entry = https://simulation.esunsec.com.tw/api/v1

        [Api]
        Key = esun-api-key
        Secret = esun-api-secret

        [User]
        Account = A123456789

        [Cert]
        Path = ./A123456789_20260619.p12
    `);

    assert.deepEqual(parsed, {
        apiUrl: 'https://simulation.esunsec.com.tw/api/v1',
        apiKey: 'esun-api-key',
        apiSecret: 'esun-api-secret',
        idNo: 'A123456789',
        certPath: './A123456789_20260619.p12',
    });
});

test('parseEsunConfigIni treats official placeholder comments as empty values', () => {
    const parsed = parseEsunConfigIni(`
        [Core]
        Entry = https://esuntradingapi.esunsec.com.tw/api/v1
        [Api]
        Key = esun-api-key
        Secret = esun-api-secret
        [User]
        Account = A123456789
        [Cert]
        Path = ;Your Cert File Path
    `);

    assert.equal(parsed.certPath, '');
});

test('parseEsunConfigIni explains missing required fields', () => {
    assert.throws(
        () =>
            parseEsunConfigIni(`
                [Core]
                Entry = https://esuntradingapi.esunsec.com.tw/api/v1
                [Api]
                Key = esun-api-key
            `),
        /玉山設定檔缺少 \[Api\] Secret/,
    );
});

test('applyEsunConfigToForm fills secrets while preserving typed passwords', () => {
    const next = applyEsunConfigToForm(baseForm, {
        apiUrl: 'https://simulation.esunsec.com.tw/api/v1',
        apiKey: 'esun-api-key',
        apiSecret: 'esun-api-secret',
        idNo: 'A123456789',
        certPath: './relative-cert.p12',
    });

    assert.deepEqual(next, {
        idNo: 'A123456789',
        password: 'login-password',
        apiKey: 'esun-api-key',
        apiSecret: 'esun-api-secret',
        certPath: '',
        certPass: 'cert-password',
        apiUrl: 'https://simulation.esunsec.com.tw/api/v1',
    });
});

test('applyEsunConfigToForm adopts absolute certificate paths only', () => {
    const macPath = applyEsunConfigToForm(baseForm, {
        apiUrl: 'https://esuntradingapi.esunsec.com.tw/api/v1',
        apiKey: 'esun-api-key',
        apiSecret: 'esun-api-secret',
        idNo: 'A123456789',
        certPath: '/Users/liweiyeh/certs/esun.p12',
    });
    const windowsPath = applyEsunConfigToForm(baseForm, {
        apiUrl: 'https://esuntradingapi.esunsec.com.tw/api/v1',
        apiKey: 'esun-api-key',
        apiSecret: 'esun-api-secret',
        idNo: 'A123456789',
        certPath: 'C:\\Users\\liweiyeh\\certs\\esun.p12',
    });

    assert.equal(macPath.certPath, '/Users/liweiyeh/certs/esun.p12');
    assert.equal(windowsPath.certPath, 'C:\\Users\\liweiyeh\\certs\\esun.p12');
});
