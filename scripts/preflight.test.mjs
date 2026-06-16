// Tests for the version-gate logic used by the build preflight check.
// Run: node --test scripts/preflight.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeVersionSatisfies, bunVersionSatisfies, commandExists } from './preflight.mjs';

// Regression guard for the POSIX `command` builtin bug: on Linux `command` is a
// shell builtin, not an executable, so a shell-less spawn falsely reports every
// tool missing. node is always on PATH (it's running this test), so this must be
// true on every OS, and a bogus name must be false.
test('commandExists finds a tool that is on PATH', () => {
  assert.equal(commandExists('node'), true);
});

test('commandExists reports a nonexistent tool as missing', () => {
  assert.equal(commandExists('definitely-not-a-real-binary-xyzzy'), false);
});

// Vite 8 requires Node ^20.19.0 || >=22.12.0 (21.x is the dropped gap).
test('nodeVersionSatisfies accepts 20.19+ within the 20.x line', () => {
  assert.equal(nodeVersionSatisfies('20.19.0'), true);
  assert.equal(nodeVersionSatisfies('20.20.5'), true);
});

test('nodeVersionSatisfies rejects 20.18 (below the Vite 8 floor)', () => {
  assert.equal(nodeVersionSatisfies('20.18.0'), false);
});

test('nodeVersionSatisfies rejects the 21.x gap', () => {
  assert.equal(nodeVersionSatisfies('21.7.0'), false);
});

test('nodeVersionSatisfies needs 22.12+ within the 22.x line', () => {
  assert.equal(nodeVersionSatisfies('22.11.0'), false);
  assert.equal(nodeVersionSatisfies('22.12.0'), true);
});

test('nodeVersionSatisfies accepts 23.x and above (>=22.12 range)', () => {
  assert.equal(nodeVersionSatisfies('23.5.0'), true);
  assert.equal(nodeVersionSatisfies('25.2.1'), true); // current build machine
});

test('nodeVersionSatisfies tolerates a leading v', () => {
  assert.equal(nodeVersionSatisfies('v22.12.0'), true);
});

test('bunVersionSatisfies requires >= 1.1.5 (cross-compile --target floor)', () => {
  assert.equal(bunVersionSatisfies('1.1.5'), true);
  assert.equal(bunVersionSatisfies('1.3.11'), true);
  assert.equal(bunVersionSatisfies('2.0.0'), true);
  assert.equal(bunVersionSatisfies('1.1.4'), false);
  assert.equal(bunVersionSatisfies('1.0.30'), false);
  assert.equal(bunVersionSatisfies('0.6.0'), false);
});
