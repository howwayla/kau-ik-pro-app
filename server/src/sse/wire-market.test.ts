// Repro/regression for the stale-quote-after-source-swap bug.
// Run: cd server && node_modules/.bin/tsx src/sse/wire-market.test.ts
//
// Symptom: after switching the market source (e.g. mock → real broker whose
// WS is down on a closed market), every new SSE connection replays the OLD
// source's last quote frames, because the hub's lastQuotes cache is not
// dropped when the source swaps and the new (silent) source never overwrites
// it. The board then shows simulated prices in a "live" broker session.

import assert from 'node:assert';
import { MarketManager } from '../providers/manager.ts';
import { SseHub } from './hub.ts';
import { wireMarketToHub } from './wire-market.ts';

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

// A market provider we can drive by hand; emits go through the manager's
// active-provider path (manager.attach wraps provider.onTick).
class FakeProvider {
    disposed = false;
    private tickCb: ((ch: string, t: unknown) => void) | null = null;
    async init() {}
    contractCount() { return 0; }
    async resolveContract() { return null as never; }
    async listOptionContracts() { return []; }
    async snapshots() { return []; }
    async kbars() { return { datetime: [], Open: [], High: [], Low: [], Close: [], Volume: [], Amount: [] }; }
    async ticks() { return {} as never; }
    async scanner() { return []; }
    async creditEnquire() { return []; }
    async shortStockSources() { return []; }
    async regulatoryPunish() { return { code: [], attention: [] }; }
    async subscribe() {}
    async unsubscribe() {}
    onTick(cb: (ch: string, t: unknown) => void) { this.tickCb = cb; }
    onBidAsk() {}
    lastPrice() { return undefined; }
    displayName() { return undefined; }
    aliasTarget() { return undefined; }
    feedHealth() { return 'mock' as const; }
    dispose() { this.disposed = true; }
    emit(code: string, close: string) {
        this.tickCb?.('tick_stk', { code, close, simtrade: false, volume: 1, total_volume: 1 });
    }
}

// Minimal ServerResponse stand-in that records what the hub writes to it.
class FakeRes {
    frames: string[] = [];
    writeHead() { return this; }
    write(s: string) { this.frames.push(s); return true; }
    on() { return this; }
    get body() { return this.frames.join(''); }
}

await check('a new SSE client does NOT replay the old source\'s quotes after a source swap', async () => {
    const market = new MarketManager();
    const hub = new SseHub();
    wireMarketToHub(market, hub);

    // mock source active, emits a quote -> hub caches it
    const mock = new FakeProvider();
    market.start(mock as never, 'mock');
    mock.emit('2330', '1075'); // the simulated price

    // sanity: a client that connects WHILE mock is the source sees it
    const before = new FakeRes();
    hub.attach(before as never);
    assert.ok(before.body.includes('"close":"1075"'), 'precondition: mock quote should be cached/replayed while mock is active');

    // switch to a real broker source whose WS is down -> emits nothing
    const broker = new FakeProvider();
    await market.swap(broker as never, 'fubon');

    // a fresh connection (e.g. the page reload after the switch) must NOT
    // be served the stale mock quote
    const after = new FakeRes();
    hub.attach(after as never);
    assert.ok(
        !after.body.includes('"close":"1075"'),
        'hub replayed a stale pre-swap mock quote (close 1075) to a client that connected after switching to the real source',
    );
});

console.log(`\n${failures === 0 ? 'ALL GREEN' : failures + ' FAILING'}`);
process.exit(failures === 0 ? 0 : 1);
