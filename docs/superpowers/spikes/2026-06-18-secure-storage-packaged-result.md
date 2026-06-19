# Secure Storage Packaged Spike Result

Date: 2026-06-18

## Decision

Use Rust/Tauri `keyring = 3.6.3` as the PR1 primary secure-storage placement.
Node/Bun native keychain remains technically plausible, but is rejected as the
primary path because it depends on native-addon packaging under `bun --compile`.
Keep it as fallback/research only.

## Commands Run

- `cargo test --manifest-path src-tauri/Cargo.toml secure_storage_spike_uses_fixed_non_broker_identifiers`
- `cargo check --manifest-path src-tauri/Cargo.toml`
- `pnpm build`
- `pnpm desktop:build`

## Packaged Verification

- Packaged app built at `src-tauri/target/release/bundle/macos/Kau-ik Pro.app`.
- DMG built at `src-tauri/target/release/bundle/dmg/Kau-ik Pro_0.1.0_aarch64.dmg`.
- Packaged binary secure-storage write result: `ok=true`, `present=true`.
- macOS Keychain presence check after write: `present`.
- Packaged binary secure-storage read result: `ok=true`, `present=true`,
  `valueMatches=true`.
- Packaged binary secure-storage delete result: `ok=true`, `present=false`.
- macOS Keychain absence check after delete: `missing`.

## Notes

- No real broker credentials were used.
- The spike uses only this fixed fake identifier:
  `io.github.howwayla.kauikpro.secure-storage-spike` / `roundtrip-test`.
- Commands and UI wrappers return status booleans only and never return secret
  values.
- A temporary Broker menu diagnostic was added and compiled successfully, but
  the core packaged verification was completed through the packaged binary so it
  would not require moving the app between macOS Spaces.
- Linux fallback remains future implementation work.
