# Secure Storage Packaged Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that Kau-ik Pro can write, read, and delete a non-broker test secret through OS secure storage from a packaged Tauri desktop app.

**Architecture:** Implement a temporary Rust/Tauri spike using `keyring = 3.6.3` in the Tauri layer, gated behind hardcoded test-only commands that never accept arbitrary secret identifiers and never return secret values. Record the Node/Bun sidecar investigation as rejected for PR1 primary use unless packaged evidence contradicts the current research.

**Tech Stack:** Tauri 2, Rust 1.77.2, `keyring` 3.6.3, React/Vite frontend, `pnpm desktop:build`, macOS Keychain for first packaged verification.

---

## Scope

This is a spike, not the broker-login implementation. It must not touch real
broker credentials and must not migrate `config.json`. It writes only a fixed
fake test secret under a fixed service/account:

```text
service = io.github.howwayla.kauikpro.secure-storage-spike
account = roundtrip-test
value   = kau-ik-pro-spike-value-v1
```

Success means:

- Packaged macOS app can write the test secret.
- Packaged macOS app can read the test secret and report `matches: true`
  without returning the value.
- Packaged macOS app can delete the test secret.
- macOS Keychain confirms presence after write and absence after delete without
  printing the password.
- The spec is updated with the selected placement: Rust/Tauri layer as PR1
  primary, Node/Bun native keychain rejected as primary and retained only as a
  fallback/research note.

## File Structure

- Modify `src-tauri/Cargo.toml`: add target-specific `keyring = "=3.6.3"`
  dependencies with platform features.
- Modify `src-tauri/src/lib.rs`: add spike command result types, hardcoded
  keyring helpers, and an invoke handler.
- Modify or create Tauri permission/capability files only if the local Tauri
  command permission model requires it.
- Create `src/lib/secure-storage-spike.ts`: tiny frontend wrapper around the
  three Tauri commands.
- Modify `src/components/hud-header.tsx`: add a temporary desktop-only trigger
  in a low-risk menu area to run write/read/delete and display status booleans.
- Modify `docs/superpowers/specs/2026-06-17-broker-login-ux-design.md`: record
  spike outcome and close the secure-storage placement decision.
- Create `docs/superpowers/spikes/2026-06-18-secure-storage-packaged-result.md`:
  record commands run, packaged verification, Keychain checks, and conclusion.

## Task 1: Rust Keyring Command Spike

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the target-specific dependency**

Add these dependency sections to `src-tauri/Cargo.toml` below the existing
`[dependencies]` block:

```toml
[target.'cfg(target_os = "macos")'.dependencies]
keyring = { version = "=3.6.3", default-features = false, features = ["apple-native"] }

[target.'cfg(target_os = "windows")'.dependencies]
keyring = { version = "=3.6.3", default-features = false, features = ["windows-native"] }

[target.'cfg(target_os = "linux")'.dependencies]
keyring = { version = "=3.6.3", default-features = false, features = ["sync-secret-service", "crypto-rust"] }
```

- [ ] **Step 2: Run Cargo check to lock dependencies**

Run:

```sh
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: dependency resolution succeeds and `src-tauri/Cargo.lock` updates.

- [ ] **Step 3: Add hardcoded spike commands**

In `src-tauri/src/lib.rs`, add:

```rust
use serde::Serialize;

const SECURE_STORAGE_SPIKE_SERVICE: &str =
    "io.github.howwayla.kauikpro.secure-storage-spike";
const SECURE_STORAGE_SPIKE_ACCOUNT: &str = "roundtrip-test";
const SECURE_STORAGE_SPIKE_VALUE: &str = "kau-ik-pro-spike-value-v1";

#[derive(Serialize)]
struct SecureStorageSpikeWriteResult {
    written: bool,
}

#[derive(Serialize)]
struct SecureStorageSpikeReadResult {
    exists: bool,
    matches: bool,
}

#[derive(Serialize)]
struct SecureStorageSpikeDeleteResult {
    deleted: bool,
    missing_after_delete: bool,
}

fn spike_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(
        SECURE_STORAGE_SPIKE_SERVICE,
        SECURE_STORAGE_SPIKE_ACCOUNT,
    )
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn secure_storage_spike_write() -> Result<SecureStorageSpikeWriteResult, String> {
    let entry = spike_entry()?;
    entry
        .set_password(SECURE_STORAGE_SPIKE_VALUE)
        .map_err(|err| err.to_string())?;
    Ok(SecureStorageSpikeWriteResult { written: true })
}

#[tauri::command]
fn secure_storage_spike_read() -> Result<SecureStorageSpikeReadResult, String> {
    let entry = spike_entry()?;
    match entry.get_password() {
        Ok(value) => Ok(SecureStorageSpikeReadResult {
            exists: true,
            matches: value == SECURE_STORAGE_SPIKE_VALUE,
        }),
        Err(keyring::Error::NoEntry) => Ok(SecureStorageSpikeReadResult {
            exists: false,
            matches: false,
        }),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
fn secure_storage_spike_delete() -> Result<SecureStorageSpikeDeleteResult, String> {
    let entry = spike_entry()?;
    let deleted = match entry.delete_credential() {
        Ok(()) => true,
        Err(keyring::Error::NoEntry) => false,
        Err(err) => return Err(err.to_string()),
    };
    let missing_after_delete = matches!(entry.get_password(), Err(keyring::Error::NoEntry));
    Ok(SecureStorageSpikeDeleteResult {
        deleted,
        missing_after_delete,
    })
}
```

Register them in the Tauri builder:

```rust
.invoke_handler(tauri::generate_handler![
    secure_storage_spike_write,
    secure_storage_spike_read,
    secure_storage_spike_delete,
])
```

- [ ] **Step 4: Run Cargo check**

Run:

```sh
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: Rust compiles. If permission generation fails, add the minimal Tauri
permission/capability files for these commands and rerun.

- [ ] **Step 5: Commit**

```sh
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/permissions src-tauri/capabilities
git commit -m "spike: add tauri secure storage commands"
```

## Task 2: Temporary Frontend Trigger

**Files:**
- Create: `src/lib/secure-storage-spike.ts`
- Modify: `src/components/hud-header.tsx`

- [ ] **Step 1: Create the Tauri invoke wrapper**

Create `src/lib/secure-storage-spike.ts`:

```ts
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './tauri';

export interface SecureStorageSpikeResult {
    write?: { written: boolean };
    readAfterWrite?: { exists: boolean; matches: boolean };
    delete?: { deleted: boolean; missing_after_delete: boolean };
    readAfterDelete?: { exists: boolean; matches: boolean };
    error?: string;
}

export async function runSecureStorageSpike(): Promise<SecureStorageSpikeResult> {
    if (!isTauri()) {
        return { error: 'Desktop app required' };
    }
    try {
        const write = await invoke<{ written: boolean }>(
            'secure_storage_spike_write',
        );
        const readAfterWrite = await invoke<{ exists: boolean; matches: boolean }>(
            'secure_storage_spike_read',
        );
        const deleteResult = await invoke<{
            deleted: boolean;
            missing_after_delete: boolean;
        }>('secure_storage_spike_delete');
        const readAfterDelete = await invoke<{ exists: boolean; matches: boolean }>(
            'secure_storage_spike_read',
        );
        return { write, readAfterWrite, delete: deleteResult, readAfterDelete };
    } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
    }
}
```

- [ ] **Step 2: Add a temporary desktop-only UI trigger**

In `src/components/hud-header.tsx`, add a small button inside a non-ordering
menu (for example the Broker menu footer) that calls `runSecureStorageSpike()`
and renders only booleans/status text:

```tsx
const [secureStorageSpike, setSecureStorageSpike] =
    useState<SecureStorageSpikeResult | null>(null);

// button text: "Run secure-storage check"
// output text example:
// "write=true read=true delete=true missing=true"
```

Do not display any secret value. Do not wire this to real broker credentials.

- [ ] **Step 3: Run frontend typecheck/build**

Run:

```sh
pnpm build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 4: Commit**

```sh
git add src/lib/secure-storage-spike.ts src/components/hud-header.tsx
git commit -m "spike: add secure storage check UI"
```

## Task 3: Packaged macOS Verification

**Files:**
- Create: `docs/superpowers/spikes/2026-06-18-secure-storage-packaged-result.md`

- [ ] **Step 1: Build packaged app**

Run:

```sh
pnpm desktop:doctor
pnpm desktop:build
```

Expected: `.app` and `.dmg` are produced under
`src-tauri/target/release/bundle/`.

- [ ] **Step 2: Launch packaged app and trigger the spike**

Open:

```text
src-tauri/target/release/bundle/macos/Kau-ik Pro.app
```

Click "Run secure-storage check".

Expected UI status:

```text
write=true read=true delete=true missing=true
```

- [ ] **Step 3: Verify Keychain without printing the secret**

After a write-only or repeatable write/read run, verify presence without `-w`:

```sh
security find-generic-password \
  -s io.github.howwayla.kauikpro.secure-storage-spike \
  -a roundtrip-test >/dev/null && echo present
```

After delete, verify absence:

```sh
security find-generic-password \
  -s io.github.howwayla.kauikpro.secure-storage-spike \
  -a roundtrip-test >/dev/null 2>&1 || echo absent
```

Expected: presence can be observed after write; absence can be observed after
delete. Never print the password.

- [ ] **Step 4: Record results**

Create `docs/superpowers/spikes/2026-06-18-secure-storage-packaged-result.md`
with:

```markdown
# Secure Storage Packaged Spike Result

Date: 2026-06-18

## Decision

Use Rust/Tauri `keyring = 3.6.3` as the PR1 primary secure-storage placement.
Reject Node/Bun native keychain as the primary path because it depends on
native-addon packaging under `bun --compile`; keep it as fallback/research only.

## Commands Run

- `cargo check --manifest-path src-tauri/Cargo.toml`
- `pnpm build`
- `pnpm desktop:doctor`
- `pnpm desktop:build`

## Packaged Verification

- Packaged app launched from `src-tauri/target/release/bundle/macos/Kau-ik Pro.app`.
- Spike UI result: `write=true read=true delete=true missing=true`.
- macOS Keychain presence check after write: `present`.
- macOS Keychain absence check after delete: `absent`.

## Notes

- No real broker credentials were used.
- Commands return booleans only and never return secret values.
- Linux fallback remains future implementation work.
```

- [ ] **Step 5: Commit**

```sh
git add docs/superpowers/spikes/2026-06-18-secure-storage-packaged-result.md
git commit -m "docs: record secure storage packaged spike"
```

## Task 4: Close Spec Decision

**Files:**
- Modify: `docs/superpowers/specs/2026-06-17-broker-login-ux-design.md`

- [ ] **Step 1: Update decision status**

Change "Where secure storage lives — pending spike" to:

```markdown
2. **Where secure storage lives — resolved.** Use Rust/Tauri `keyring = 3.6.3`
   as the PR1 primary secure-storage placement. Node/Bun native keychain remains
   documented as technically plausible but rejected as the primary architecture
   because it depends on native-addon packaging under `bun --compile`.
```

- [ ] **Step 2: Update Secure Storage Abstraction note**

Make the review note say:

```markdown
The sidecar-facing interface still exists, but its implementation must call the
Rust/Tauri secure-storage bridge rather than a native Node keychain module.
```

- [ ] **Step 3: Run docs check**

Run:

```sh
rg -n "pending spike|Open Decisions|resolve first|TBD|TODO" docs/superpowers/specs/2026-06-17-broker-login-ux-design.md docs/superpowers/spikes/2026-06-18-secure-storage-packaged-result.md
```

Expected: no output.

- [ ] **Step 4: Commit**

```sh
git add docs/superpowers/specs/2026-06-17-broker-login-ux-design.md
git commit -m "docs: select tauri keyring secure storage"
```

## Final Verification

Run:

```sh
pnpm test
pnpm desktop:doctor
```

Expected: both commands pass.

Then report:

- Whether packaged macOS keychain write/read/delete passed.
- Which secure-storage placement was selected.
- Any files or temporary spike UI that must be removed or converted before PR1
  production implementation.
