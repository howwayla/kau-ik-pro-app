// Single source of truth for the desktop build target table.
//
// Tauri appends the Rust host target triple to each `externalBin` entry, so the
// sidecar binary must be named `nova-server-<rustTriple>` (+`.exe` on Windows).
// `bun build --compile --target <bunTarget>` uses a *different* naming system,
// so we keep the mapping in one place. The four `supported` entries below mirror
// the build matrix in .github/workflows/release.yml — a drift-guard test asserts
// they never diverge.

/** rustTriple -> { bunTarget, ext } */
export const TARGETS = {
  // Officially supported (in the release.yml CI matrix):
  'aarch64-apple-darwin': { bunTarget: 'bun-darwin-arm64', ext: '' },
  'x86_64-apple-darwin': { bunTarget: 'bun-darwin-x64', ext: '' },
  'x86_64-unknown-linux-gnu': { bunTarget: 'bun-linux-x64', ext: '' },
  'x86_64-pc-windows-msvc': { bunTarget: 'bun-windows-x64', ext: '.exe' },
  // Build-capable but not in the CI matrix (no prebuilt artifacts ship; local
  // builds work). Handled gracefully so an AI assistant can still build on these:
  'aarch64-unknown-linux-gnu': { bunTarget: 'bun-linux-arm64', ext: '' },
  'aarch64-pc-windows-msvc': { bunTarget: 'bun-windows-arm64', ext: '.exe' },
};

// musl/Alpine: bun can compile the sidecar, but Tauri's WebKitGTK stack needs
// glibc. Refuse early with an actionable message rather than half-building.
const MUSL = new Set(['x86_64-unknown-linux-musl', 'aarch64-unknown-linux-musl']);

/**
 * Resolve a Rust host triple to everything the build needs.
 * @param {string} rustTriple e.g. "aarch64-apple-darwin"
 * @returns {{ rustTriple: string, bunTarget: string, ext: string, sidecarName: string }}
 * @throws if the triple is unknown or unsupported (musl)
 */
export function resolveTarget(rustTriple) {
  if (MUSL.has(rustTriple)) {
    throw new Error(
      `Host "${rustTriple}" uses musl (Alpine). The sidecar can compile, but ` +
        `Tauri's webview (WebKitGTK) is not supported on musl here.\n` +
        `Build the desktop app on a glibc distro (Debian/Ubuntu/Fedora) instead.`,
    );
  }
  const entry = TARGETS[rustTriple];
  if (!entry) {
    throw new Error(
      `Unrecognized Rust host triple "${rustTriple}".\n` +
        `Supported: ${Object.keys(TARGETS).join(', ')}.`,
    );
  }
  return {
    rustTriple,
    bunTarget: entry.bunTarget,
    ext: entry.ext,
    sidecarName: `nova-server-${rustTriple}${entry.ext}`,
  };
}

/**
 * Parse the authoritative host triple from `rustc -vV` output. This is the same
 * triple Tauri uses for the externalBin suffix, so reading it (rather than
 * guessing from process.arch) eliminates a whole class of "sidecar not found"
 * bugs — including the Rosetta case where process.arch lies.
 * @param {string} rustcVVOutput
 * @returns {string}
 * @throws if no host line is present
 */
export function parseHostTripleFromRustcVV(rustcVVOutput) {
  const match = /^host:\s*(\S+)/m.exec(rustcVVOutput);
  if (!match) {
    throw new Error(`Could not find a "host:" line in rustc -vV output:\n${rustcVVOutput}`);
  }
  return match[1];
}
