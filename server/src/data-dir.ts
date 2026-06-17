import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

interface ResolveDataDirOptions {
    env?: Partial<Record<string, string | undefined>>;
    metaUrl?: string;
    cwd?: string;
    platform?: NodeJS.Platform;
}

const APP_DATA_ID = 'io.github.howwayla.kauikpro';

function packagedDataDir(
    env: Partial<Record<string, string | undefined>>,
    platform: NodeJS.Platform,
): string {
    if (platform === 'darwin') {
        const home = env.HOME || homedir();
        return join(home, 'Library', 'Application Support', APP_DATA_ID);
    }
    if (platform === 'win32') {
        const base = env.APPDATA || env.LOCALAPPDATA || homedir();
        return join(base, APP_DATA_ID);
    }
    const base = env.XDG_DATA_HOME || join(env.HOME || homedir(), '.local', 'share');
    return join(base, APP_DATA_ID);
}

export function resolveServerDataDir(
    options: ResolveDataDirOptions = {},
): string {
    const env = options.env ?? process.env;
    const dataDir = env.KAUIK_DATA_DIR?.trim();
    if (dataDir) return resolve(dataDir);

    const metaUrl = options.metaUrl ?? import.meta.url;
    const cwd = options.cwd ?? process.cwd();
    const platform = options.platform ?? process.platform;
    const here = dirname(fileURLToPath(metaUrl));

    if (here === '/$bunfs' || here.startsWith('/$bunfs/')) {
        return packagedDataDir(env, platform);
    }

    return join(here, '..', 'data');
}
