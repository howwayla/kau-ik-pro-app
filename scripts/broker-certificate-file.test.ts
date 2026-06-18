import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    chooseCertificateFileWithOpen,
    normalizeCertificateSelection,
} from '../src/lib/broker-certificate-file.ts';

test('normalizeCertificateSelection accepts a single path', () => {
    assert.equal(
        normalizeCertificateSelection('/private/certs/fubon.p12'),
        '/private/certs/fubon.p12',
    );
});

test('normalizeCertificateSelection accepts the first selected path', () => {
    assert.equal(
        normalizeCertificateSelection(['/private/certs/fubon.pfx']),
        '/private/certs/fubon.pfx',
    );
});

test('normalizeCertificateSelection returns null for cancel', () => {
    assert.equal(normalizeCertificateSelection(null), null);
    assert.equal(normalizeCertificateSelection([]), null);
});

test('chooseCertificateFileWithOpen opens a certificate-only dialog', async () => {
    const calls: unknown[] = [];
    const selected = await chooseCertificateFileWithOpen(async (options) => {
        calls.push(options);
        return '/private/certs/nova.p12';
    });

    assert.equal(selected, '/private/certs/nova.p12');
    assert.deepEqual(calls, [
        {
            multiple: false,
            directory: false,
            filters: [
                {
                    name: 'Broker certificate',
                    extensions: ['p12', 'pfx'],
                },
            ],
        },
    ]);
});
