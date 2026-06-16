# AGENTS.md — for AI assistants helping someone build & run Nova Pro

This file is operational context for an AI coding assistant (Claude Code, Cursor,
Codex, etc.). Your job: get a **willing but non-expert user** from `git clone`
to a **running desktop app in mock mode** on **their** OS, and recover them from
build errors yourself. Humans should read [`README.md`](README.md) first.

## Mission & scope

**In scope** — what you should help with:
- Installing the prerequisites for their OS.
- Running the one command and explaining what they'll see.
- Diagnosing and fixing build failures (see the Troubleshooting table).

**Out of scope** — do NOT do these:
- ❌ Broker / API credential onboarding (Fubon / Taishin / Esun / Fugle keys).
  Mock mode needs none. Never ask the user to paste real credentials.
- ❌ macOS code-signing / notarization, or disabling Gatekeeper globally. A
  self-built `.app` opens fine; at most a one-time right-click → Open.
- ❌ Introducing any Fugle branding — this is a personal open-source project.

## How the desktop build works (mental model)

A 3-stage pipeline the user should **not** run by hand — `scripts/build-desktop.mjs`
automates all of it, including picking the right target triple:

1. **bun** compiles `server/src/index.ts` → a single-file sidecar binary named
   `nova-server-<rustTriple>` (`+.exe` on Windows), into `src-tauri/binaries/`.
2. `src-tauri/tauri.conf.json` → `externalBin: ["binaries/nova-server"]` embeds it
   (Tauri auto-appends the host triple, which is why the filename must match).
3. `tauri build` compiles the Rust shell and bundles the app; at runtime the
   shell auto-spawns the sidecar on `127.0.0.1:8080` and kills it on exit.

The target table (Rust host triple → bun target → filename) lives once in
`scripts/desktop-targets.mjs` and is shared with `.github/workflows/release.yml`
(a test enforces they don't drift). `.github/workflows/release.yml` is the
source of truth for which platforms ship prebuilt artifacts.

## Environment contract — verify BEFORE building

Run `pnpm desktop:doctor` first; it checks all of the below and prints the exact
fix for anything missing. Or check manually (run each, compare):

| Tool | Need | Why |
|---|---|---|
| `node -v` | ^20.19 or ≥22.12 (`.nvmrc` = 22) | Vite 8 hard requirement |
| `pnpm -v` | 10.x (`corepack enable`) | pnpm workspace — **do not use npm** |
| `bun -v` | ≥ 1.1.5 | compiles the sidecar |
| `cargo -V` | any stable (rustup) | Tauri shell |

Plus OS system libraries: macOS → Xcode CLT; Windows → MSVC Build Tools +
WebView2; Debian/Ubuntu → the apt list in README. If any check fails, install
it, re-verify, **then** build. Don't start a build with a known-missing tool.

## The one command

```sh
pnpm install
pnpm desktop:build      # installable bundle  → src-tauri/target/release/bundle/
# faster first touch, no installer:
pnpm desktop:dev        # live Tauri dev window
pnpm dev:all            # browser only (no Rust/bun needed) → http://localhost:5173
```

Success signal: the app launches showing a **「模擬環境」** (mock) badge; no
credentials prompted. Mock data (≈127 contracts) loads on its own.

## Troubleshooting — match the error substring, apply the fix

The build log is the source of truth. Find the substring, apply the fix, re-run.

| Error message contains… | Cause | Fix |
|---|---|---|
| `Vite requires Node` / `engine "node"` / unsupported Node | Node too old / wrong line | Install Node 22.12+ (`nvm install 22 && nvm use 22`) |
| `bun: command not found` / bun ENOENT | bun not installed | `curl -fsSL https://bun.sh/install \| bash` (Win: `irm bun.sh/install.ps1 \| iex`) |
| `bun … too old` | bun < 1.1.5 | `bun upgrade` |
| `rustc: command not found` / `cargo: not found` | Rust missing | Install via <https://rustup.rs>, then restart shell |
| `linker 'cc' not found` / `xcrun: error: invalid active developer path` (mac) | no Xcode CLT | `xcode-select --install` |
| `link.exe not found` / MSVC linker error (Windows) | no MSVC C++ Build Tools | Install VS Build Tools → "Desktop development with C++" |
| host triple ends in `-windows-gnu` (Windows) | Rust on GNU toolchain | `rustup default stable-x86_64-pc-windows-msvc` |
| `libwebkit2gtk-4.1 … not found` / `glib-2.0 not found` (Linux) | system libs missing | run the apt list in README; needs Ubuntu 22.04+ |
| `failed to run linuxdeploy` (Linux, AppImage step) | linuxdeploy (a FUSE AppImage) is unreliable on Ubuntu 24.04+ | the build script already skips AppImage on Linux (builds `.deb`/`.rpm`); you should not hit this via `pnpm desktop:build`. If you force AppImage, install libfuse2 or set `APPIMAGE_EXTRACT_AND_RUN=1` |
| `nova-server-<triple> not found` / `failed to bundle … external binary` | sidecar name/path mismatch | re-run `pnpm desktop:build`; confirm `src-tauri/binaries/` holds the host-triple name |
| `ERR_PNPM … frozen-lockfile` / lockfile mismatch | clone drift | `pnpm install` (without `--frozen-lockfile`) |
| build is silent for several minutes | Rust release compile is quiet | **wait** — do not Ctrl-C; first build can take 5–15 min |
| (mac) `"Nova Pro" is damaged / cannot be opened` | adhoc-unsigned, quarantined | right-click the app → Open (don't disable Gatekeeper) |
| (Win) `Windows protected your PC` (SmartScreen) | unsigned installer | More info → Run anyway, or use `pnpm desktop:dev` |
| (Win) blank white window on launch | WebView2 missing (old Windows) | install the WebView2 Evergreen runtime |
| `musl` / Alpine build error | WebKitGTK unsupported on musl | build on a glibc distro (Debian/Ubuntu/Fedora) |

If an error isn't here, read the failing command's output, fix the root cause,
and re-run `pnpm desktop:doctor` then the build.

## Repo map

- `server/` — Fastify local server; **sidecar source** (`src/index.ts`). Mock by default.
- `src/` — React 19 front-end (Vite, vanilla-extract).
- `src-tauri/` — Rust shell, `tauri.conf.json`, `binaries/` (sidecar output, gitignored).
- `scripts/build-desktop.mjs` — the one-command builder (preflight + sidecar + tauri).
- `scripts/desktop-targets.mjs` — host→target table (SSOT); `*.test.mjs` next to each script (`pnpm test`).
- `.github/workflows/release.yml` — CI build matrix (4 platforms); source of truth for shipped targets.

## Conventions / don'ts

- Use **pnpm**, never npm (workspace + lockfile).
- Don't commit `src-tauri/binaries/` or `server/data/` (gitignored).
- The broker SDK `.tgz` files in `server/vendor/` **are** committed on purpose.
- If you change the target table, change it in `scripts/desktop-targets.mjs`
  only — `release.yml` derives from it and `pnpm test` guards against drift.
