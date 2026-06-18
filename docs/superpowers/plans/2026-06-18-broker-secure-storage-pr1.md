# Broker Secure Storage PR1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move broker login text secrets out of persisted `config.json` and into the Rust/Tauri secure-storage bridge, while keeping broker login behavior testable and safe.

**Architecture:** The sidecar config file becomes metadata-only: broker setup state, certificate path, and broker API URL. Text secrets live in OS secure storage through the Tauri layer. The React desktop UI may pass newly typed setup values to Tauri commands, but saved-login flows should use a Tauri broker action that reads secrets internally and calls the local sidecar without returning secret values to the UI.

**Tech Stack:** TypeScript sidecar, Tauri 2, Rust `keyring = 3.6.3`, React/Vite, `tsx` tests, `pnpm test`, `pnpm desktop:build`.

---

## File Structure

- Modify `server/src/config.ts`: split broker metadata from secret fields and expose helper types.
- Create `server/src/broker-credential-parts.ts`: pure split/assemble helpers for TDD and migration.
- Create `server/src/broker-credential-parts.test.ts`: regression tests proving persisted config can be metadata-only.
- Modify `server/src/runtime-config.ts`: load legacy `brokerCreds`, expose metadata-only config, and write metadata without secret fields.
- Modify `server/src/provider-switch.ts`: resolve credentials from explicit request, metadata plus injected secrets, legacy config, or env.
- Modify `server/src/routes/config.ts`: stop persisting plaintext secrets after successful broker login.
- Modify `src-tauri/src/lib.rs`: promote the spike into broker-specific secure-storage commands using fixed broker identifiers.
- Modify `src-tauri/src/main.rs`: keep non-secret CLI checks useful for packaged verification.
- Modify `src/lib/secure-storage-spike.ts` or replace with a production broker secure-storage wrapper.
- Modify `src/components/hud-header.tsx`: hide or remove the temporary diagnostic from the regular broker menu once production wiring exists.

## Task 1: Metadata/Secret Split Helpers

**Files:**
- Create: `server/src/broker-credential-parts.test.ts`
- Create: `server/src/broker-credential-parts.ts`
- Modify: `package.json`

- [x] **Step 1: Write failing tests**

Create tests that prove:

```ts
import assert from 'node:assert/strict';
import {
    assembleBrokerCreds,
    splitBrokerCreds,
    type BrokerSecrets,
} from './broker-credential-parts.ts';
import type { BrokerCreds } from './config.ts';

const full: BrokerCreds = {
    idNo: 'A123456789',
    password: 'account-pass',
    apiKey: 'api-key',
    apiSecret: 'api-secret',
    certPath: '/private/certs/fubon.p12',
    certPass: 'cert-pass',
    apiUrl: 'https://broker.example.test',
};

const secretKeys = ['idNo', 'password', 'apiKey', 'apiSecret', 'certPass'];

const { metadata, secrets } = splitBrokerCreds(full);
for (const key of secretKeys) {
    assert.equal(Object.hasOwn(metadata, key), false);
}
assert.deepEqual(metadata, {
    certPath: '/private/certs/fubon.p12',
    apiUrl: 'https://broker.example.test',
});
assert.deepEqual(secrets, {
    idNo: 'A123456789',
    password: 'account-pass',
    apiKey: 'api-key',
    apiSecret: 'api-secret',
    certPass: 'cert-pass',
});
assert.deepEqual(assembleBrokerCreds(metadata, secrets), full);
assert.equal(assembleBrokerCreds(metadata, null), null);
```

- [x] **Step 2: Verify the tests fail**

Run:

```sh
pnpm --filter kau-ik-pro-server exec tsx src/broker-credential-parts.test.ts
```

Expected: failure because `broker-credential-parts.ts` does not exist.

- [x] **Step 3: Implement the helpers**

Implement:

```ts
import type { BrokerCreds } from './config.ts';

export type BrokerMetadata = Pick<BrokerCreds, 'certPath' | 'apiUrl'>;
export type BrokerSecrets = Pick<
    BrokerCreds,
    'idNo' | 'password' | 'apiKey' | 'apiSecret' | 'certPass'
>;

export function splitBrokerCreds(creds: BrokerCreds): {
    metadata: BrokerMetadata;
    secrets: BrokerSecrets;
};

export function assembleBrokerCreds(
    metadata: Partial<BrokerMetadata> | undefined | null,
    secrets: Partial<BrokerSecrets> | undefined | null,
): BrokerCreds | null;
```

- [x] **Step 4: Verify helper tests pass**

Run:

```sh
pnpm --filter kau-ik-pro-server exec tsx src/broker-credential-parts.test.ts
```

Expected: `ALL GREEN`.

- [x] **Step 5: Add the test to the root test script**

Modify `package.json` so `pnpm test` runs `server/src/broker-credential-parts.test.ts`.

- [x] **Step 6: Commit**

```sh
git add package.json server/src/broker-credential-parts.ts server/src/broker-credential-parts.test.ts docs/superpowers/plans/2026-06-18-broker-secure-storage-pr1.md
git commit -m "test: add broker credential split helpers"
```

## Task 2: Runtime Config Metadata-Only Persistence

**Files:**
- Modify: `server/src/runtime-config.ts`
- Create: `server/src/runtime-config.test.ts`

- [x] **Step 1: Write failing tests**

Create tests proving:
- Legacy `brokerCreds.fubon` loads and is exposed for migration.
- `set()` writes `brokerMetadata` but does not write `idNo`, `password`, `apiKey`, `apiSecret`, or `certPass`.
- `tradeProvider` defaults to `mock` unless explicitly persisted.

- [x] **Step 2: Verify tests fail**

Run:

```sh
pnpm --filter kau-ik-pro-server exec tsx src/runtime-config.test.ts
```

Expected: failure because metadata-only persistence does not exist yet.

- [x] **Step 3: Implement metadata-only runtime config**

Add `brokerMetadata` to `RuntimeConfig`, keep `legacyBrokerCreds` readable in memory for migration, and make writes omit secret fields.

- [x] **Step 4: Verify runtime config tests pass**

Run:

```sh
pnpm --filter kau-ik-pro-server exec tsx src/runtime-config.test.ts
```

Expected: `ALL GREEN`.

## Task 3: Broker Secret Store Commands

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/main.rs`

- [x] **Step 1: Write Rust tests for fixed broker identifiers**

Test that only `fubon`, `nova`, and `esun` map to fixed keyring accounts and that unsupported broker names are rejected.

- [x] **Step 2: Verify tests fail**

Run:

```sh
cargo test --manifest-path src-tauri/Cargo.toml broker_secret
```

- [x] **Step 3: Implement broker secret get/set/delete internals**

Store one JSON blob per broker under a fixed service and fixed account:

```text
service = io.github.howwayla.kauikpro.broker-secrets
account = fubon:v1 | nova:v1 | esun:v1
```

Invoke commands must return status only; internal login helpers may read secrets.

- [x] **Step 4: Verify Rust tests pass**

Run:

```sh
cargo test --manifest-path src-tauri/Cargo.toml broker_secret
```

## Task 4: Stop Persisting Plaintext Broker Secrets

**Files:**
- Modify: `server/src/provider-switch.ts`
- Modify: `server/src/routes/config.ts`
- Modify: `src/components/hud-header.tsx`

- [ ] **Step 1: Write route/provider tests around saved state**

Use pure helpers or route-level fakes to prove successful login persists metadata only and saved-state checks do not rely on plaintext secret fields.

- [ ] **Step 2: Verify tests fail**

Run the new test command.

- [ ] **Step 3: Implement minimal route changes**

On successful broker login, write metadata only. Saved-login status should come from metadata plus secure-storage status, not from `credsComplete(savedBrokerCreds)`.

- [ ] **Step 4: Verify tests pass**

Run:

```sh
pnpm test
```

## Final Verification

Run:

```sh
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml broker_secret
pnpm desktop:doctor
pnpm desktop:build
```

Expected: all pass, packaged macOS binary can still perform secure-storage checks, and no real broker credential values are printed.
