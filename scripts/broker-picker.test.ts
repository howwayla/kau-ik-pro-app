import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveTradePickerAction } from '../src/lib/broker-picker.ts';

const metadata = {
    cert_path: '/private/certs/fubon.p12',
    api_url: '',
};

test('resolveTradePickerAction uses saved broker metadata outside Tauri too', () => {
    const action = resolveTradePickerAction({
        provider: 'fubon',
        current: 'mock',
        busy: false,
        availability: { env: false, saved: true },
        metadata,
    });

    assert.deepEqual(action, { kind: 'saved-switch', metadata });
});

test('resolveTradePickerAction opens setup when saved metadata is missing', () => {
    const action = resolveTradePickerAction({
        provider: 'fubon',
        current: 'mock',
        busy: false,
        availability: { env: false, saved: true },
        metadata: null,
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
        }),
        { kind: 'switch' },
    );
});
