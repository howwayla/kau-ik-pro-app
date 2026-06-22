import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    resolveTradePickerAction,
    savedBrokerNames,
} from '../src/lib/broker-picker.ts';

const metadata = {
    cert_path: '/private/certs/fubon.p12',
    api_url: '',
};

test('resolveTradePickerAction uses keychain saved switch in desktop mode', () => {
    const action = resolveTradePickerAction({
        provider: 'fubon',
        current: 'mock',
        busy: false,
        availability: { env: false, saved: true },
        metadata,
        canUseSecureStorage: true,
    });

    assert.deepEqual(action, { kind: 'saved-switch', metadata });
});

test('resolveTradePickerAction falls back to server switch outside Tauri', () => {
    const action = resolveTradePickerAction({
        provider: 'fubon',
        current: 'mock',
        busy: false,
        availability: { env: false, saved: true },
        metadata,
        canUseSecureStorage: false,
    });

    assert.deepEqual(action, { kind: 'switch' });
});

test('resolveTradePickerAction opens setup when saved metadata is missing', () => {
    const action = resolveTradePickerAction({
        provider: 'fubon',
        current: 'mock',
        busy: false,
        availability: { env: false, saved: true },
        metadata: null,
        canUseSecureStorage: true,
    });

    assert.deepEqual(action, { kind: 'setup' });
});

test('resolveTradePickerAction switches directly for mock and env providers', () => {
    assert.deepEqual(
        resolveTradePickerAction({
            provider: 'mock',
            current: 'fubon',
            busy: false,
            availability: undefined,
            metadata: null,
            canUseSecureStorage: true,
        }),
        { kind: 'switch' },
    );

    assert.deepEqual(
        resolveTradePickerAction({
            provider: 'fubon',
            current: 'mock',
            busy: false,
            availability: { env: true, saved: false },
            metadata: null,
            canUseSecureStorage: true,
        }),
        { kind: 'switch' },
    );
});

test('savedBrokerNames lists brokers that can be manually reconnected', () => {
    assert.deepEqual(
        savedBrokerNames({
            fubon: { env: false, saved: true },
            nova: { env: true, saved: false },
            esun: { env: false, saved: false },
        }),
        ['fubon', 'nova'],
    );
});
