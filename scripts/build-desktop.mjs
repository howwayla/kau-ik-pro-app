#!/usr/bin/env node
// Build the Nova Pro desktop app from source — one command, any supported OS.
//
// What it does (so you never have to type a target triple):
//   1. preflight: check node/rust/bun/pnpm, print exact fixes for anything missing
//   2. detect the Rust host triple (the name Tauri expects for the sidecar)
//   3. compile the Node server -> single-file sidecar binary with that exact name
//   4. run `tauri build` (a distributable .app/.dmg/.msi/.AppImage) or `tauri dev`
//
// Usage:
//   node scripts/build-desktop.mjs            # full build -> installable bundle
//   node scripts/build-desktop.mjs --dev      # live dev window (fastest desktop touch)
//   node scripts/build-desktop.mjs --doctor   # only check the toolchain, then exit
//   node scripts/build-desktop.mjs --sidecar-only [--target <rustTriple>]  # CI / smoke test
//   ... add --clean to wipe src-tauri/binaries first
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, rmSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { resolveTarget, parseHostTripleFromRustcVV } from './desktop-targets.mjs';
import { preflight, systemDepsHint } from './preflight.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN_DIR = resolve(repoRoot, 'src-tauri/binaries');
const SERVER_ENTRY = 'server/src/index.ts';
const isWin = process.platform === 'win32';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

function die(msg) {
  console.error(`\n✖ [build-desktop] ${msg}\n`);
  process.exit(1);
}

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', cwd: repoRoot, shell: isWin, ...opts });
  if (r.error) {
    die(r.error.code === 'ENOENT' ? `\`${cmd}\` not found on PATH — is it installed?` : `could not run \`${cmd}\`: ${r.error.message}`);
  }
  if (r.status !== 0) die(`\`${cmd} ${cmdArgs.join(' ')}\` failed (exit ${r.status ?? r.signal}).`);
}

function detectHostTriple() {
  try {
    return parseHostTripleFromRustcVV(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }));
  } catch (err) {
    die(
      `Could not detect the Rust host triple via \`rustc -vV\`.\n` +
        `Install Rust (https://rustup.rs) and re-run.\n  (${err.message})`,
    );
  }
}

function runPreflight() {
  const problems = preflight();
  if (problems.length === 0) {
    console.log('✓ [build-desktop] toolchain OK (node, rust, bun, pnpm).');
    const hint = systemDepsHint();
    if (hint) console.log(`  note: this OS also needs system libraries —\n    ${hint}`);
    return;
  }
  console.error('\n✖ [build-desktop] environment not ready:\n');
  for (const p of problems) console.error(`  • ${p.problem}\n    → ${p.fix}\n`);
  const hint = systemDepsHint();
  if (hint) console.error(`  • Also make sure system libraries are installed:\n    → ${hint}\n`);
  process.exit(1);
}

function compileSidecar(rustTriple) {
  let resolved;
  try {
    resolved = resolveTarget(rustTriple); // throws with a clear message on musl/unknown
  } catch (err) {
    die(err.message);
  }
  const { bunTarget, sidecarName } = resolved;
  const outfile = resolve(BIN_DIR, sidecarName);
  mkdirSync(BIN_DIR, { recursive: true });
  console.log(`\n[1/2] compiling sidecar  host=${rustTriple}  bun=${bunTarget}  ->  binaries/${sidecarName}`);
  run('bun', ['build', SERVER_ENTRY, '--compile', '--target', bunTarget, '--outfile', outfile]);
  if (!existsSync(outfile)) die(`sidecar was not produced at ${outfile} — check the bun output above.`);
  console.log(`      sidecar ready (${(statSizeMB(outfile))} MB).`);
  return outfile;
}

function statSizeMB(p) {
  try {
    return Math.round(statSync(p).size / 1e6);
  } catch {
    return '?';
  }
}

// --- main ------------------------------------------------------------------
const doctor = has('--doctor');
const dev = has('--dev');
const sidecarOnly = has('--sidecar-only');
const explicitTarget = valueOf('--target');

if (has('--clean') && existsSync(BIN_DIR)) {
  for (const f of readdirSync(BIN_DIR)) rmSync(resolve(BIN_DIR, f), { force: true });
  console.log('[build-desktop] cleaned src-tauri/binaries/');
}

if (doctor) {
  runPreflight();
  console.log('\n✓ ready to build. Run:  pnpm desktop:build   (or: pnpm desktop:dev)\n');
  process.exit(0);
}

// CI passes an explicit --target and manages its own toolchain; users go through preflight.
if (!sidecarOnly) runPreflight();

const triple = explicitTarget ?? detectHostTriple();
const outfile = compileSidecar(triple);

if (sidecarOnly) {
  console.log(`\n✓ sidecar only: ${outfile}\n`);
  process.exit(0);
}

const tauriCmd = dev ? 'dev' : 'build';
// AppImage bundling shells out to linuxdeploy, itself a FUSE AppImage. Ubuntu
// 24.04+ ships without libfuse2, so tell the AppImage tooling to extract-and-run
// instead of mounting via FUSE — otherwise `tauri build` fails at the AppImage step.
if (process.platform === 'linux') process.env.APPIMAGE_EXTRACT_AND_RUN = '1';
console.log(
  `\n[2/2] ${dev ? 'starting Tauri dev window' : 'bundling the desktop app'} (\`tauri ${tauriCmd}\`)` +
    `${dev ? '' : ' — Rust release build, this takes several minutes; do not interrupt'}…\n`,
);
run('pnpm', ['exec', 'tauri', tauriCmd]);

if (!dev) {
  console.log(
    `\n✓ done. Installable bundle(s) under:\n` +
      `    src-tauri/target/release/bundle/\n` +
      `  Launch it — you'll see a 模擬環境 (mock) badge; no credentials needed.\n`,
  );
}
