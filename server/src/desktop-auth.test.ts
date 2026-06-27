import assert from 'node:assert/strict';
import { desktopIdentitySignature, verifyDesktopAuthHeader } from './desktop-auth.ts';

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

await check('desktopIdentitySignature changes with the nonce', () => {
    const first = desktopIdentitySignature('token', 'nonce-a');
    const second = desktopIdentitySignature('token', 'nonce-b');

    assert.notEqual(first, second);
    assert.match(first, /^[a-f0-9]{64}$/);
});

await check('verifyDesktopAuthHeader accepts only the configured token', () => {
    assert.equal(verifyDesktopAuthHeader(undefined, 'token'), false);
    assert.equal(verifyDesktopAuthHeader('token', 'token'), true);
    assert.equal(verifyDesktopAuthHeader('wrong', 'token'), false);
    assert.equal(verifyDesktopAuthHeader(undefined, undefined), false);
});

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILING'}`);
process.exit(failures === 0 ? 0 : 1);
