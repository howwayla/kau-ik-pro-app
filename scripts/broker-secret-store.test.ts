import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    deleteBrokerSecretsWithInvoke,
    freshLoginBrokerWithInvoke,
    loginBrokerWithSavedSecretsWithInvoke,
    saveBrokerSecretsWithInvoke,
    statusBrokerSecretsWithInvoke,
    type BrokerSecretCommandResult,
    type BrokerSecretInvokeCommand,
} from '../src/lib/broker-secret-store.ts';
import type { BrokerSetupForm } from '../src/lib/broker-secret-payload.ts';

const form: BrokerSetupForm = {
    idNo: 'A123456789',
    password: 'account-pass',
    apiKey: 'api-key',
    apiSecret: 'api-secret',
    certPath: '/private/certs/nova.p12',
    certPass: 'cert-pass',
    apiUrl: 'https://broker.example.test',
};

function recorder(
    result: unknown = {
        ok: true,
        present: true,
        error: null,
    },
) {
    const calls: {
        command: BrokerSecretInvokeCommand;
        args: Record<string, unknown>;
    }[] = [];
    return {
        calls,
        invoke: async <T>(
            command: BrokerSecretInvokeCommand,
            args: Record<string, unknown>,
        ) => {
            calls.push({ command, args });
            return result as T;
        },
    };
}

test('saveBrokerSecretsWithInvoke sends only secret fields to Tauri', async () => {
    const { calls, invoke } = recorder();

    await saveBrokerSecretsWithInvoke(invoke, 'nova', form);

    assert.deepEqual(calls, [
        {
            command: 'broker_secret_save',
            args: {
                broker: 'nova',
                secrets: {
                    idNo: 'A123456789',
                    password: 'account-pass',
                    apiKey: 'api-key',
                    apiSecret: 'api-secret',
                    certPass: 'cert-pass',
                },
            },
        },
    ]);
    assert.equal(
        Object.hasOwn(calls[0]?.args?.secrets as object, 'certPath'),
        false,
    );
    assert.equal(Object.hasOwn(calls[0]?.args?.secrets as object, 'apiUrl'), false);
});

test('statusBrokerSecretsWithInvoke checks a fixed broker slot', async () => {
    const { calls, invoke } = recorder({ ok: true, present: false, error: null });

    const result = await statusBrokerSecretsWithInvoke(invoke, 'esun');

    assert.deepEqual(result, { ok: true, present: false, error: null });
    assert.deepEqual(calls, [
        { command: 'broker_secret_status', args: { broker: 'esun' } },
    ]);
});

test('deleteBrokerSecretsWithInvoke clears a fixed broker slot', async () => {
    const { calls, invoke } = recorder({ ok: true, present: false, error: null });

    await deleteBrokerSecretsWithInvoke(invoke, 'fubon');

    assert.deepEqual(calls, [
        { command: 'broker_secret_delete', args: { broker: 'fubon' } },
    ]);
});

test('saveBrokerSecretsWithInvoke throws when secure storage fails', async () => {
    const { invoke } = recorder({
        ok: false,
        present: false,
        error: 'keychain unavailable',
    });

    await assert.rejects(
        () => saveBrokerSecretsWithInvoke(invoke, 'fubon', form),
        /keychain unavailable/,
    );
});

test('loginBrokerWithSavedSecretsWithInvoke sends only metadata to Tauri', async () => {
    const { calls, invoke } = recorder({
        ok: true,
        provider: 'nova',
        market: 'nova',
        warning: null,
        error: null,
    });

    await loginBrokerWithSavedSecretsWithInvoke(invoke, 'nova', {
        cert_path: '/private/certs/nova.p12',
        api_url: 'https://broker.example.test',
    });

    assert.deepEqual(calls, [
        {
            command: 'broker_secret_login',
            args: {
                broker: 'nova',
                metadata: {
                    certPath: '/private/certs/nova.p12',
                    apiUrl: 'https://broker.example.test',
                },
            },
        },
    ]);
    assert.equal(JSON.stringify(calls).includes('password'), false);
    assert.equal(JSON.stringify(calls).includes('apiSecret'), false);
    assert.equal(JSON.stringify(calls).includes('certPass'), false);
});

test('freshLoginBrokerWithInvoke sends form metadata and secrets to the authed command', async () => {
    const { calls, invoke } = recorder({
        ok: true,
        provider: 'nova',
        market: 'nova',
        warning: null,
        error: null,
    });

    const result = await freshLoginBrokerWithInvoke(invoke, 'nova', form);

    assert.deepEqual(result, {
        ok: true,
        provider: 'nova',
        market: 'nova',
        warning: null,
        error: null,
    });
    assert.deepEqual(calls, [
        {
            command: 'broker_fresh_login',
            args: {
                broker: 'nova',
                metadata: {
                    certPath: '/private/certs/nova.p12',
                    apiUrl: 'https://broker.example.test',
                },
                secrets: {
                    idNo: 'A123456789',
                    password: 'account-pass',
                    apiKey: 'api-key',
                    apiSecret: 'api-secret',
                    certPass: 'cert-pass',
                },
            },
        },
    ]);
});

test('freshLoginBrokerWithInvoke throws when the live login fails', async () => {
    const { invoke } = recorder({
        ok: false,
        provider: null,
        market: null,
        warning: null,
        error: '本機服務身分驗證不符',
    });

    await assert.rejects(
        () => freshLoginBrokerWithInvoke(invoke, 'fubon', form),
        /本機服務身分驗證不符/,
    );
});
