import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { resolveServerDataDir } from './data-dir.ts';

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

await check('uses KAUIK_DATA_DIR when the server is running from a bun compiled sidecar', () => {
    assert.equal(
        resolveServerDataDir({
            env: { KAUIK_DATA_DIR: '/Users/me/Library/Application Support/Kau-ik Pro' },
            metaUrl: 'file:///$bunfs/root/nova-server-aarch64-apple-darwin',
            cwd: '/Applications/Kau-ik Pro.app/Contents/MacOS',
        }),
        '/Users/me/Library/Application Support/Kau-ik Pro',
    );
});

await check('uses macOS Application Support when a packaged bun sidecar has no data dir env', () => {
    assert.equal(
        resolveServerDataDir({
            env: { HOME: '/Users/me' },
            metaUrl: 'file:///$bunfs/root/nova-server-aarch64-apple-darwin',
            cwd: '/',
            platform: 'darwin',
        }),
        '/Users/me/Library/Application Support/io.github.howwayla.kauikpro',
    );
});

await check('keeps the source checkout server/data path for tsx development', () => {
    assert.equal(
        resolveServerDataDir({
            env: {},
            metaUrl: 'file:///repo/server/src/index.ts',
            cwd: '/repo',
        }),
        resolve('/repo/server/data'),
    );
});

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILING'}`);
process.exit(failures === 0 ? 0 : 1);
