import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { loadConfig } from '../config.ts';
import type { AppContext } from '../context.ts';
import { RuntimeConfigStore } from '../runtime-config.ts';
import { registerConfigRoutes } from './config.ts';

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

function tempConfigPath() {
    return join(mkdtempSync(join(tmpdir(), 'kau-ik-config-route-')), 'config.json');
}

function buildTestApp(runtimeConfig: RuntimeConfigStore) {
    const app = Fastify();
    registerConfigRoutes(app, {
        config: loadConfig({}),
        runtimeConfig,
        market: { name: () => 'mock' },
        trading: { name: () => 'mock' },
        hub: { clearQuoteCache() {} },
    } as unknown as AppContext);
    return app;
}

await check('POST /api/v1/config/trade/metadata persists only broker metadata', async () => {
    const filePath = tempConfigPath();
    const runtimeConfig = new RuntimeConfigStore(filePath);
    const app = buildTestApp(runtimeConfig);

    const res = await app.inject({
        method: 'POST',
        url: '/api/v1/config/trade/metadata',
        payload: {
            provider: 'fubon',
            cert_path: '/private/certs/fubon.p12',
            api_url: 'https://broker.example.test',
        },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(runtimeConfig.get().brokerMetadata.fubon, {
        certPath: '/private/certs/fubon.p12',
        apiUrl: 'https://broker.example.test',
    });
    const persistedText = readFileSync(filePath, 'utf8');
    assert.ok(persistedText.includes('brokerMetadata'));
    assert.equal(persistedText.includes('brokerCreds'), false);
    assert.equal(persistedText.includes('password'), false);
});

await check('POST /api/v1/config/trade/metadata rejects mock provider', async () => {
    const app = buildTestApp(new RuntimeConfigStore(tempConfigPath()));

    const res = await app.inject({
        method: 'POST',
        url: '/api/v1/config/trade/metadata',
        payload: {
            provider: 'mock',
            cert_path: '/private/certs/fubon.p12',
        },
    });

    assert.equal(res.statusCode, 400);
});

await check('GET /api/v1/config/trade exposes metadata without secrets', async () => {
    const runtimeConfig = new RuntimeConfigStore(tempConfigPath());
    runtimeConfig.set({
        brokerMetadata: {
            nova: {
                certPath: '/private/certs/nova.p12',
                apiUrl: 'https://broker.example.test',
            },
        },
    });
    const app = buildTestApp(runtimeConfig);

    const res = await app.inject({
        method: 'GET',
        url: '/api/v1/config/trade',
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.creds.nova.saved, true);
    assert.deepEqual(body.metadata.nova, {
        cert_path: '/private/certs/nova.p12',
        api_url: 'https://broker.example.test',
    });
    assert.equal(JSON.stringify(body).includes('password'), false);
    assert.equal(JSON.stringify(body).includes('api_secret'), false);
    assert.equal(JSON.stringify(body).includes('cert_pass'), false);
});

await check('GET /api/v1/config/trade exposes default broker preference', async () => {
    const runtimeConfig = new RuntimeConfigStore(tempConfigPath());
    runtimeConfig.set({ defaultTradeBroker: 'esun' });
    const app = buildTestApp(runtimeConfig);

    const res = await app.inject({
        method: 'GET',
        url: '/api/v1/config/trade',
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().default_broker, 'esun');
});

await check('POST /api/v1/config/trade/default persists default broker preference', async () => {
    const filePath = tempConfigPath();
    const runtimeConfig = new RuntimeConfigStore(filePath);
    const app = buildTestApp(runtimeConfig);

    const res = await app.inject({
        method: 'POST',
        url: '/api/v1/config/trade/default',
        payload: { provider: 'fubon' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(runtimeConfig.get().defaultTradeBroker, 'fubon');
    const persistedText = readFileSync(filePath, 'utf8');
    assert.ok(persistedText.includes('defaultTradeBroker'));
    assert.equal(persistedText.includes('password'), false);
});

await check('POST /api/v1/config/trade/default clears default broker preference', async () => {
    const runtimeConfig = new RuntimeConfigStore(tempConfigPath());
    runtimeConfig.set({ defaultTradeBroker: 'fubon' });
    const app = buildTestApp(runtimeConfig);

    const res = await app.inject({
        method: 'POST',
        url: '/api/v1/config/trade/default',
        payload: { provider: null },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(runtimeConfig.get().defaultTradeBroker, null);
});

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILING'}`);
process.exit(failures === 0 ? 0 : 1);
