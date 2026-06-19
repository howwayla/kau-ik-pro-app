import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
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

const bunfsMetaUrl = 'file:///$bunfs/root/nova-server-aarch64-apple-darwin';

await check('uses KAUIK_DATA_DIR when the server is running from a bun compiled sidecar', () => {
    const dataDir = resolve('tmp/kauik-data');

    assert.equal(
        resolveServerDataDir({
            env: { KAUIK_DATA_DIR: dataDir },
            metaUrl: bunfsMetaUrl,
            cwd: resolve('Applications/Kau-ik Pro.app/Contents/MacOS'),
        }),
        dataDir,
    );
});

await check('uses macOS Application Support when a packaged bun sidecar has no data dir env', () => {
    const home = resolve('Users/me');

    assert.equal(
        resolveServerDataDir({
            env: { HOME: home },
            metaUrl: bunfsMetaUrl,
            cwd: resolve('/'),
            platform: 'darwin',
        }),
        join(
            home,
            'Library',
            'Application Support',
            'io.github.howwayla.kauikpro',
        ),
    );
});

await check('keeps the source checkout server/data path for tsx development', () => {
    const serverIndex = resolve('repo/server/src/index.ts');

    assert.equal(
        resolveServerDataDir({
            env: {},
            metaUrl: pathToFileURL(serverIndex).href,
            cwd: resolve('repo'),
        }),
        resolve('repo/server/data'),
    );
});

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILING'}`);
process.exit(failures === 0 ? 0 : 1);
