// Preflight environment checks for the desktop build.
//
// The product goal: a willing non-expert + an AI assistant can build from
// source. The single highest-leverage move is to detect a missing/old toolchain
// BEFORE any slow work and print the exact, OS-specific command to fix it — so
// the assistant can recover the user instead of staring at a cryptic ENOENT.
import { spawnSync } from 'node:child_process';

const isWin = process.platform === 'win32';

/** Node >= 20.19 (within 20.x) or >= 22.12 — the Vite 8 requirement. */
export function nodeVersionSatisfies(version) {
  const [maj, min] = version.replace(/^v/, '').split('.').map(Number);
  if (maj === 20) return min >= 19;
  if (maj === 21) return false; // dropped, non-LTS gap
  if (maj === 22) return min >= 12;
  return maj > 22; // 23, 24, 25, ...
}

/** bun >= 1.1.5 — the version that shipped `--compile --target`. */
export function bunVersionSatisfies(version) {
  const [maj, min, pat] = version.replace(/^v/, '').split('.').map(Number);
  if (maj !== 1) return maj > 1;
  if (min !== 1) return min > 1;
  return pat >= 5;
}

// Is `cmd` resolvable on PATH? On POSIX, `command` is a shell builtin (no
// executable to spawn directly), so we run it through `sh`; cmd is passed as a
// positional ($1) so there is no shell-injection surface. On Windows, `where`.
export function commandExists(cmd) {
  const r = isWin
    ? spawnSync('where', [cmd], { stdio: 'ignore' })
    : spawnSync('sh', ['-c', 'command -v "$1"', 'sh', cmd], { stdio: 'ignore' });
  return r.status === 0;
}

function tryVersion(cmd, args = ['--version']) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: isWin });
  if (r.status !== 0 || !r.stdout) return null;
  const m = /(\d+\.\d+\.\d+)/.exec(r.stdout);
  return m ? m[1] : null;
}

const INSTALL = {
  rust: 'Install Rust: https://rustup.rs  (then restart your shell or `source "$HOME/.cargo/env"`)',
  bun: isWin
    ? 'Install bun: powershell -c "irm bun.sh/install.ps1 | iex"'
    : 'Install bun: curl -fsSL https://bun.sh/install | bash',
  pnpm: 'Enable pnpm: `corepack enable`  (or: npm i -g pnpm)',
  node: 'Install Node 22.12+ (LTS): https://nodejs.org  — this repo pins 22 in .nvmrc',
};

const UPGRADE = {
  bun: 'Run `bun upgrade`  (or reinstall from https://bun.sh).',
};

const SYSTEM_DEPS = {
  darwin: 'macOS: install the Xcode Command Line Tools — `xcode-select --install`',
  win32:
    'Windows: install "Desktop development with C++" (MSVC Build Tools) from the Visual Studio Installer. ' +
    'WebView2 ships with Windows 11 and most up-to-date Windows 10; if the app opens to a blank white window, ' +
    'install the WebView2 Evergreen runtime.',
  linux:
    'Linux (Debian/Ubuntu): sudo apt update && sudo apt install -y libwebkit2gtk-4.1-dev ' +
    'build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev',
};

/**
 * Run all checks. Returns an array of problems; empty means good to build.
 * @returns {{tool: string, problem: string, fix: string}[]}
 */
export function preflight() {
  const problems = [];

  if (!nodeVersionSatisfies(process.versions.node)) {
    problems.push({
      tool: 'node',
      problem: `Node ${process.versions.node} is unsupported (need ^20.19 or >=22.12 for Vite 8).`,
      fix: INSTALL.node,
    });
  }

  if (!commandExists('rustc') || !commandExists('cargo')) {
    problems.push({ tool: 'rust', problem: 'Rust toolchain (rustc/cargo) not found — Tauri needs it.', fix: INSTALL.rust });
  }

  if (!commandExists('bun')) {
    problems.push({ tool: 'bun', problem: 'bun not found — needed to compile the server sidecar.', fix: INSTALL.bun });
  } else {
    const v = tryVersion('bun');
    if (!v) {
      problems.push({ tool: 'bun', problem: 'bun is installed but its version could not be read.', fix: UPGRADE.bun });
    } else if (!bunVersionSatisfies(v)) {
      problems.push({ tool: 'bun', problem: `bun ${v} is too old (need >=1.1.5).`, fix: UPGRADE.bun });
    }
  }

  if (!commandExists('pnpm')) {
    problems.push({ tool: 'pnpm', problem: 'pnpm not found — this repo is a pnpm workspace (do not use npm).', fix: INSTALL.pnpm });
  }

  return problems;
}

/** One-line per-OS system-dependency reminder (printed as guidance, not a hard check). */
export function systemDepsHint() {
  return SYSTEM_DEPS[process.platform] ?? '';
}
