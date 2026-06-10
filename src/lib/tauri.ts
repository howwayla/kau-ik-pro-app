// src/lib/tauri.ts — desktop bridge: sidecar server management, popout
// windows, auto-updates. Every entry point is a no-op in the browser.

import { isTauri } from './runtime';
import { notify } from './trade';

export { isTauri } from './runtime';

// ---- shioaji server sidecar ----

export interface ServerStatus {
    running: boolean;
    pid?: number;
    port?: number;
    healthy?: boolean;
    simulation?: boolean;
}

export interface SidecarResult {
    ok: boolean;
    output: string;
}

async function sidecar(
    args: string[],
    env?: Record<string, string>,
): Promise<SidecarResult> {
    const { Command } = await import('@tauri-apps/plugin-shell');
    const cmd = Command.sidecar('binaries/shioaji', args, {
        env: env && Object.keys(env).length > 0 ? env : undefined,
    });
    const out = await cmd.execute();
    const text = `${out.stdout}\n${out.stderr}`.trim();
    return { ok: out.code === 0, output: text };
}

export async function serverStatus(): Promise<ServerStatus | null> {
    if (!isTauri) return null;
    try {
        const res = await sidecar(['server', 'status', '--format', 'json']);
        const jsonStart = res.output.indexOf('{');
        if (jsonStart >= 0) {
            return JSON.parse(res.output.slice(jsonStart)) as ServerStatus;
        }
    } catch {
        // sidecar missing / failed
    }
    return null;
}

export async function serverStart(opts: {
    apiKey: string;
    secretKey: string;
    production: boolean;
}): Promise<SidecarResult> {
    const env: Record<string, string> = {
        SJ_API_KEY: opts.apiKey,
        SJ_SEC_KEY: opts.secretKey,
    };
    const args = ['server', 'start', '--no-open'];
    if (opts.production) args.push('--production');
    return sidecar(args, env);
}

export async function serverStop(): Promise<SidecarResult> {
    return sidecar(['server', 'stop']);
}

// ---- settings store (API keys live in the app-data dir, not the repo) ----

export interface DesktopSettings {
    apiKey: string;
    secretKey: string;
    production: boolean;
}

export async function loadDesktopSettings(): Promise<DesktopSettings> {
    if (!isTauri) return { apiKey: '', secretKey: '', production: false };
    const { LazyStore } = await import('@tauri-apps/plugin-store');
    const store = new LazyStore('settings.json');
    return {
        apiKey: (await store.get<string>('apiKey')) ?? '',
        secretKey: (await store.get<string>('secretKey')) ?? '',
        production: (await store.get<boolean>('production')) ?? false,
    };
}

export async function saveDesktopSettings(s: DesktopSettings) {
    if (!isTauri) return;
    const { LazyStore } = await import('@tauri-apps/plugin-store');
    const store = new LazyStore('settings.json');
    await store.set('apiKey', s.apiKey);
    await store.set('secretKey', s.secretKey);
    await store.set('production', s.production);
    await store.save();
}

// ---- popout windows ----

let popoutCounter = 0;

export async function openPopout(type: string, code: string | null) {
    const qs = new URLSearchParams({ popout: type, code: code ?? '' });
    if (!isTauri) {
        window.open(
            `${window.location.pathname}?${qs}`,
            `sj-popout-${type}-${code ?? 'x'}`,
            'width=900,height=620,menubar=no,toolbar=no',
        );
        return;
    }
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    popoutCounter += 1;
    new WebviewWindow(`popout-${type}-${popoutCounter}`, {
        url: `index.html?${qs}`,
        title: `Shioaji Pro — ${type}${code ? ` · ${code}` : ''}`,
        width: 900,
        height: 620,
        minWidth: 420,
        minHeight: 300,
    });
}

// ---- auto-update ----

let updateInFlight = false;

export async function checkForUpdates(silent: boolean) {
    if (!isTauri || updateInFlight) return;
    updateInFlight = true;
    try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const update = await check();
        if (!update) {
            if (!silent) {
                notify({
                    kind: 'info',
                    title: '已是最新版本',
                    body: '目前沒有可用更新',
                });
            }
            return;
        }
        notify({
            kind: 'info',
            title: `⬇️ 下載更新 v${update.version}`,
            body: '更新完成後將自動重新啟動',
        });
        await update.downloadAndInstall();
        const { relaunch } = await import('@tauri-apps/plugin-process');
        await relaunch();
    } catch (e) {
        if (!silent) {
            notify({
                kind: 'err',
                title: '更新檢查失敗',
                body: e instanceof Error ? e.message : String(e),
            });
        }
    } finally {
        updateInFlight = false;
    }
}

// ---- tray events ----

export async function listenTrayEvents(onOpenServerManager: () => void) {
    if (!isTauri) return () => undefined;
    const { listen } = await import('@tauri-apps/api/event');
    const un1 = await listen('open-server-manager', onOpenServerManager);
    const un2 = await listen('check-updates', () => checkForUpdates(false));
    return () => {
        un1();
        un2();
    };
}
