# Broker Login UX and Secure Storage Design

Date: 2026-06-17
Reviewed: 2026-06-18 — read "Implementation Review" before building. The target
persona is now resolved; secure-storage placement remains pending a packaged
spike comparing the Rust/Tauri layer with the Node/Bun sidecar.

## Purpose

Kau-ik Pro should let non-technical users configure and use real broker
accounts without understanding environment variables, config files, absolute
certificate paths, or OS credential stores. The experience must stay safe by
default, make the current trading environment obvious, and keep daily broker
switching fast once setup is complete.

## Goals

- Support Fubon, Taishin Nova, and Esun in one consistent broker setup flow.
- Keep app startup safe while allowing experienced users to opt into faster
  startup behavior.
- Store secrets in the operating system's secure storage when available.
- Import certificate files into the app's private data folder so users do not
  need to preserve the original file location after setup.
- Translate broker and SDK failures into actionable user-facing messages.
- Migrate existing local `config.json` credentials into the new storage model
  without breaking current users.

## Non-Goals for the First Version

- Multiple profiles per broker.
- Cloud sync or backup of broker credentials.
- A separate master password or encrypted vault.
- Secondary encryption of imported certificate files.
- Reworking order-entry safety controls beyond showing the active broker.

Each broker gets one saved setup in the first version. Users who need to change
accounts use "Change login data" to replace that broker's setup.

## Implementation Review (2026-06-18)

Reviewed against the current codebase before implementation. Most of the
user-facing flow described below is already built (see "Already exists" for the
specific files); the genuinely new and hard part is OS secure storage.

### Decision Status

1. **Target persona — resolved.** This is a deliberate broadening toward
   non-technical desktop users. The app should still support source-build users,
   but the broker setup experience should not require environment variables,
   absolute paths, Keychain knowledge, or config-file editing.

2. **Where secure storage lives — pending spike.** Rust/Tauri layer vs
   Node/Bun sidecar must be compared on a packaged build before implementation.
   This
   spec places `BrokerSecretStore` in the Node sidecar (see "Secure Storage
   Abstraction"). That is the riskiest placement:
   - Node OS-keychain access almost always goes through `keytar`, which is
     archived and effectively unmaintained (confirm current state during the
     spike).
   - The sidecar ships as a single `bun --compile` binary. The three commits
     immediately before this spec on this branch were all fixing
     bun-compiled-sidecar filesystem problems (`persist sidecar data outside
     bunfs`, `use app data dir for packaged server`, `retry stale tauri cache
     build`). Bundling a native Node addon into that binary is exactly the kind
     of thing that runs under `dev` and breaks once packaged.
   - Recommended default: do keychain access in the **Rust/Tauri layer**
     (e.g. `keyring-rs`) and have the sidecar request assembled credentials over
     the existing local HTTP boundary or a Tauri command. The spike (Rollout
     step 1) must compare both placements on a *packaged* build, not just `dev`,
     and then update this spec with the selected placement.

### Already exists — do not rebuild

These are implemented today; extend them rather than re-create:

- Per-broker login forms for fubon / nova (Taishin) / esun + mock —
  `src/components/hud-header.tsx:330` (`BrokerMenu()`).
- Credential precedence (request body → `server/data/config.json` → env vars) —
  `server/src/provider-switch.ts:23` (`resolveBrokerCreds()`).
- Broker-specific fields, saved-credential skip, and "log in with a different
  account" — `src/components/hud-header.tsx`.
- `GET` / `POST /api/v1/config/trade` login + hot-swap route —
  `server/src/routes/config.ts:75`.
- Credential type (`BrokerCreds`) and broker enum (`BrokerName`) —
  `server/src/config.ts`.

Genuinely new or large-change work is only: (1) OS keychain, (2) certificate
import into the app data folder (today the SDKs read the user's original
absolute path), (3) file-picker UI (today it is a plain text field for the
path), (4) Broker Center rebrand, (5) startup preference / auto-login, (6) daily
real-environment notice, (7) `config.json` → metadata-only migration.

### Recommended build sequence (two PRs, not one)

The eight-step rollout is one very large PR. Split it:

- **PR 1 (high value, low risk):** file picker + certificate import into app
  data + move only the text secrets into the keychain, with `config.json`
  reduced to metadata. This removes today's two real pain points — pasting
  absolute certificate paths, and plaintext passwords in `config.json`.
- **PR 2 (polish):** Broker Center rebrand, startup preference / auto-login,
  daily real-environment notice.

The first implementation plan should target PR 1 only. PR 2 remains part of the
product direction, but it should not block removing plaintext secrets and
absolute certificate paths from the current flow.

### Smaller notes

- **The Linux fallback gives no security gain.** The "local user-only file"
  fallback is functionally identical to today's `config.json` (plaintext,
  owner-only). Acceptable, but say so plainly in the UI so a user on a
  Secret-Service-less Linux box knows they are at status quo, not protected.
- **Test migration against a live config first.** `server/data/config.json`
  currently holds complete nova + fubon credentials (passwords, certificate
  paths, certificate passwords). Back it up before running migration code — the
  first real migration target is the maintainer's own machine.
- **Keeping the certificate file as a plaintext, owner-only file is correct.** A
  `.pfx` / `.p12` is already protected by its certificate password; with that
  password in the keychain, the file alone is useless. The "no secondary cert
  encryption" non-goal is the right call for v1.
- The error-translation list already covers "Taishin session already in use by
  another app," which has bitten this project before. Keep it.

## Broker Coverage

| Broker | User-facing name | Required setup fields | Trading capability messaging |
| --- | --- | --- | --- |
| `fubon` | Fubon | National ID, password or API Key, certificate file, certificate password | Stocks, futures/options, broker-side condition orders when available |
| `nova` | Taishin | National ID, password, certificate file, certificate password | Stocks |
| `esun` | Esun | Securities account/AID, password, API Key, API Secret, certificate file, certificate password | Stocks |

The setup wizard uses one shared flow, with broker-specific fields and helper
text after the user selects a broker.

## UX Model

### Broker Center

The current "broker menu" should evolve into a broker status center. It should
show:

- Current environment: mock or a real broker.
- Fubon, Taishin, and Esun setup state.
- Last used broker, when relevant.
- Startup preference.

Broker states:

- Not set up: shows "Set up and log in".
- Set up: shows "Log in" and secondary actions.
- Logging in: shows progress and disables duplicate actions.
- Logged in: shows active broker and "Log out to mock".
- Login failed: shows a plain-language error and next action.

### First-Time Setup Flow

1. User starts in mock mode.
2. User opens Broker Center.
3. User chooses a broker that is not set up.
4. Setup wizard opens with broker-specific fields.
5. User selects a `.p12` or `.pfx` certificate file through a file picker.
6. User enters the broker's required login fields.
7. User clicks "Save and log in".
8. App validates fields locally.
9. App imports the certificate into the app data folder.
10. App writes secrets to secure storage.
11. App attempts broker login.
12. On success, app switches to that broker's real environment.
13. On failure, app preserves typed values during the session where safe and
    shows a clear recovery action.

The primary completion action is "Save and log in"; there is no separate
"save only" path in the first version.

### Daily Use

- Set-up brokers are one-click login targets.
- Clicking a set-up broker logs in and switches immediately.
- Logging out returns to mock mode and keeps all saved setup data.
- Changing login data reruns the setup wizard and replaces that broker's saved
  setup only after the new setup succeeds.
- Deleting broker data removes secrets, imported certificates, and metadata.
  If the deleted broker is currently active, the app returns to mock mode first.

### Startup Preference

Default startup behavior:

- Start in mock mode.
- Show last used broker as the recommended quick action.
- Do not automatically log in.

Advanced startup preferences:

- Always start in mock mode.
- Show last used broker without auto-login.
- Automatically log in to a selected broker.

Enabling automatic real-broker login requires a clear one-time explanation:

"Opening the app will connect to a real broker account. Order-entry safety locks
remain separate."

## Real Environment Safety

The app must make real-broker state visually obvious:

- Top badge: `Real Environment · Fubon`, `Real Environment · Taishin`, or
  `Real Environment · Esun`.
- Order tickets show the active broker name.
- Once per day per broker, entering real mode shows a non-blocking notice:
  "You are connected to a real broker account. Orders will be sent as real
  orders."
- Login does not unlock fast order entry. Lightning/order-entry safety controls
  remain independent.

The app should not show a blocking confirmation on every order. That would make
the terminal hard to use and should remain separate from broker-login safety.

## Storage Model

### Secure Storage

Store all login-required text secrets in OS secure storage:

- National ID or securities account/AID.
- Account password.
- Fubon API Key.
- Esun API Key and API Secret.
- Certificate password.

OS targets:

- macOS: Keychain.
- Windows: Credential Manager.
- Linux: Secret Service where available.

If Linux secure storage is unavailable, the UI offers an explicit fallback:

"This computer does not have an available system secure storage service. You can
store login data in a local user-only file instead."

The user can choose "Use local storage" or cancel setup. macOS and Windows should
not silently fall back unless the secure store API is genuinely unavailable and
the user explicitly accepts the fallback.

### App Metadata

The app config file stores non-secret metadata only:

- Broker setup state.
- Imported certificate file path.
- Last used broker.
- Startup preference.
- Last date that the real-environment notice was shown.
- Broker capability cache, if useful for display.

It should not store passwords, API keys, API secrets, certificate passwords,
national IDs, or account/AID values.

### Certificate Files

The setup wizard imports the selected certificate file into the app private data
folder. The app then uses the imported path for future logins.

Recommended structure:

```text
<app-data>/
  broker/
    fubon/certificate.pfx
    nova/certificate.p12
    esun/certificate.p12
```

The app should set owner-only permissions where the OS supports it. Deleting a
broker setup removes that broker's imported certificate file.

Certificate files are sensitive. The first version protects them through app
private storage and OS file permissions while keeping the certificate password in
secure storage. Extra file encryption can be considered later if the app's threat
model expands.

## Server and API Shape

The server should expose broker setup and login operations without returning
secrets to the frontend.

Suggested endpoints:

- `GET /api/v1/config/trade`: broker states, active provider, startup
  preference, last used broker, capability summary.
- `POST /api/v1/brokers/:broker/setup`: import certificate, save secure
  fields, attempt login, persist metadata only after a valid setup.
- `POST /api/v1/brokers/:broker/login`: log in using saved secure storage and
  imported certificate.
- `POST /api/v1/brokers/logout`: return to mock mode.
- `POST /api/v1/brokers/:broker/change`: replace a broker setup after the new
  setup validates.
- `DELETE /api/v1/brokers/:broker`: delete secure storage entries, imported
  certificate, and broker metadata.
- `PATCH /api/v1/config/startup`: update startup preference.

The exact route names can follow existing project conventions, but the
capabilities above should remain separate. Setup, login, logout, change, and
delete have different safety semantics.

## Secure Storage Abstraction

Add a server-side credential store interface so providers do not know how
credentials are stored:

```ts
interface BrokerSecretStore {
    available(): Promise<{ ok: true } | { ok: false; reason: string }>;
    getBrokerSecrets(broker: BrokerName): Promise<BrokerSecrets | null>;
    setBrokerSecrets(broker: BrokerName, secrets: BrokerSecrets): Promise<void>;
    deleteBrokerSecrets(broker: BrokerName): Promise<void>;
}
```

Provider login continues to receive a complete `BrokerCreds` object, but the
object is assembled from metadata plus secure storage at the boundary.

This keeps provider code focused on broker SDK behavior and keeps storage
decisions isolated.

> **Review (2026-06-18):** The interface is the right shape, but its *placement*
> is pending spike validation (see Implementation Review → Decision Status #2). If
> keychain access ends up in the Rust/Tauri layer, this interface still lives in
> the sidecar but its implementation calls out to Tauri rather than to a native
> Node keychain module. Decide placement in the spike before writing the
> implementation.

## Migration

Existing users may already have `brokerCreds` in `config.json`. The migration
must be safe and reversible during the same app run:

1. Detect legacy `brokerCreds` with secret fields.
2. For each complete broker setup, import the certificate if needed.
3. Write secrets to secure storage.
4. Write metadata-only config.
5. Remove secret fields from config only after all writes succeed for that
   broker.
6. If migration fails, keep the legacy config intact and show a recovery message
   in Broker Center.

The migration should keep `tradeProvider` safe. App startup should not
auto-login unless the startup preference explicitly allows it.

## Error Translation

SDK and OS errors should be mapped to clear messages and next actions.

Error categories:

- Certificate file cannot be read.
- Certificate password is incorrect.
- Broker password or API key is incorrect.
- Esun API Key or API Secret is incorrect.
- Broker service is temporarily unavailable.
- Network is unavailable.
- Taishin API session is already in use by another app.
- Secure storage is unavailable.
- Certificate import failed.
- Saved setup is incomplete.

Each error should include one suggested recovery action, such as "Choose the
certificate file again", "Update login data", "Close the other Taishin session",
or "Return to mock mode".

## Testing Strategy

Unit tests:

- Credential metadata never includes secret fields.
- Credential assembly combines metadata and secure storage correctly.
- Migration removes secrets only after secure-store writes succeed.
- Deleting a broker removes metadata, secure-store entries, and imported
  certificate files.
- Startup preference resolves to the expected boot behavior.
- Error mapping returns user-facing messages for known SDK patterns.

Integration tests:

- Mock secure storage backend for setup/login/delete flows.
- Mock certificate import to verify path and permissions behavior.
- Existing environment variable login continues to work for development and
  headless usage.

Manual verification:

- macOS Keychain write/read/delete.
- Windows Credential Manager write/read/delete.
- Linux Secret Service happy path and unavailable fallback.
- Packaged desktop app uses the Tauri app data directory.

## Rollout Plan

1. Spike secure storage on a **packaged** build (not just `dev`) across macOS,
   Windows, and the Linux fallback, comparing keychain access in the Rust/Tauri
   layer versus the Node sidecar (see Implementation Review → Decision Status #2).
   Pick the placement before step 2.
2. Finalize the credential-store implementation choice based on the spike.
3. Implement metadata-only config and migration.
4. Implement certificate import/delete.
5. Implement setup/login/logout/change/delete APIs.
6. Replace the broker menu with Broker Center and setup wizard.
7. Add startup preference and real-environment daily notice.
8. Verify packaged app behavior on macOS, then CI/available OS targets.

## First-Version Product Decision

The first version limits each broker to one saved setup. This is intentional for
clarity. Multi-profile support can be added later if real users need multiple
accounts per broker.
