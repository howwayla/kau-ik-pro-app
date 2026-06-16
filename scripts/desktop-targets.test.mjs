// Tests for the desktop build target table (single source of truth).
// Run: node --test scripts/desktop-targets.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { resolveTarget, parseHostTripleFromRustcVV } from './desktop-targets.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('resolveTarget maps the macOS arm64 triple to the sidecar name Tauri expects', () => {
  const r = resolveTarget('aarch64-apple-darwin');
  assert.equal(r.bunTarget, 'bun-darwin-arm64');
  assert.equal(r.ext, '');
  assert.equal(r.sidecarName, 'nova-server-aarch64-apple-darwin');
});

test('resolveTarget appends .exe for the Windows MSVC triple', () => {
  const r = resolveTarget('x86_64-pc-windows-msvc');
  assert.equal(r.bunTarget, 'bun-windows-x64');
  assert.equal(r.ext, '.exe');
  assert.equal(r.sidecarName, 'nova-server-x86_64-pc-windows-msvc.exe');
});

test('resolveTarget covers all four official CI matrix triples', () => {
  for (const triple of [
    'aarch64-apple-darwin',
    'x86_64-apple-darwin',
    'x86_64-unknown-linux-gnu',
    'x86_64-pc-windows-msvc',
  ]) {
    const r = resolveTarget(triple);
    assert.ok(r.bunTarget.startsWith('bun-'), `${triple} -> ${r.bunTarget}`);
    assert.equal(r.sidecarName, `nova-server-${triple}${r.ext}`);
  }
});

test('resolveTarget throws a clear error on an unknown triple', () => {
  assert.throws(() => resolveTarget('sparc-unknown-meow'), /unrecognized|unknown|unsupported/i);
});

test('resolveTarget refuses musl with an actionable glibc message', () => {
  assert.throws(() => resolveTarget('x86_64-unknown-linux-musl'), /glibc|musl/i);
});

test('parseHostTripleFromRustcVV extracts the host line', () => {
  const sample = [
    'rustc 1.96.0 (ac68faa20 2026-05-25)',
    'binary: rustc',
    'host: aarch64-apple-darwin',
    'release: 1.96.0',
  ].join('\n');
  assert.equal(parseHostTripleFromRustcVV(sample), 'aarch64-apple-darwin');
});

test('parseHostTripleFromRustcVV throws when no host line is present', () => {
  assert.throws(() => parseHostTripleFromRustcVV('rustc 1.96.0\nbinary: rustc'), /host/i);
});

// DRIFT GUARD: the CI build matrix and this table share one source of truth.
// release.yml now derives the bunTarget by calling the build script (which uses
// TARGETS), so the only thing the matrix lists is `target:`. If someone adds a
// platform to CI that the script can't handle, this fails loudly instead of
// shipping a broken build.
test('every release.yml matrix target is a supported target in the SSOT table (no drift)', () => {
  const yml = readFileSync(resolve(repoRoot, '.github/workflows/release.yml'), 'utf8');
  const targets = [...yml.matchAll(/^\s*target:\s*(\S+)/gm)].map((m) => m[1]);
  assert.ok(targets.length >= 4, `expected >=4 matrix targets, got ${targets.length}`);
  for (const triple of targets) {
    const resolved = resolveTarget(triple); // throws if unknown/unsupported
    assert.ok(resolved.bunTarget.startsWith('bun-'), `${triple} -> ${resolved.bunTarget}`);
  }
});
