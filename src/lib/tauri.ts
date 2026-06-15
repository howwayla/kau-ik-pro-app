// src/lib/tauri.ts — desktop bridge: popout windows. Every entry point is a
// no-op in the browser. The Node server is auto-spawned by the Rust shell as a
// sidecar (see src-tauri/src/lib.rs), so the frontend no longer manages it.

import { isTauri } from './runtime';

export { isTauri } from './runtime';

// ---- popout windows ----

let popoutCounter = 0;

export async function openPopout(type: string, code: string | null) {
    const qs = new URLSearchParams({ popout: type, code: code ?? '' });
    if (!isTauri) {
        window.open(
            `${window.location.pathname}?${qs}`,
            `np-popout-${type}-${code ?? 'x'}`,
            'width=900,height=620,menubar=no,toolbar=no',
        );
        return;
    }
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    popoutCounter += 1;
    new WebviewWindow(`popout-${type}-${popoutCounter}`, {
        url: `index.html?${qs}`,
        title: `Nova Pro — ${type}${code ? ` · ${code}` : ''}`,
        width: 900,
        height: 620,
        minWidth: 420,
        minHeight: 300,
    });
}
