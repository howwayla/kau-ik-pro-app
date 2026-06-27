import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { brokerLoginSuccessMessage } from './providers/logging.ts';

test('brokerLoginSuccessMessage does not include account identifiers', () => {
    const message = brokerLoginSuccessMessage('fubon', ['證券', '期貨']);

    assert.equal(message, 'fubon: 登入成功（證券、期貨帳戶可用）');
    for (const value of ['A123456789', '1234567', 'account-001']) {
        assert.equal(message.includes(value), false);
    }
});

test('broker provider success logs do not interpolate account identifiers', () => {
    const files = [
        'providers/fubon/trading.ts',
        'providers/nova/trading.ts',
        'providers/esun/trading.ts',
    ];

    for (const file of files) {
        const source = readFileSync(new URL(file, import.meta.url), 'utf8');
        const successLogs = [
            ...source.matchAll(
                /console\.log\([\s\S]*?brokerLoginSuccessMessage[\s\S]*?\);/g,
            ),
        ].map((match) => match[0]);

        assert.ok(
            successLogs.length > 0,
            `${file} uses redacted success logging`,
        );
        for (const log of successLogs) {
            assert.doesNotMatch(
                log,
                /idNo|branchNo|branchName|\.account|account\}/,
                `${file} success log should avoid account identifiers`,
            );
        }
    }
});
