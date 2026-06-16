import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ResolveDataDirOptions {
    env?: Partial<Record<string, string | undefined>>;
    metaUrl?: string;
    cwd?: string;
}

export function resolveServerDataDir(
    options: ResolveDataDirOptions = {},
): string {
    const env = options.env ?? process.env;
    const dataDir = env.KAUIK_DATA_DIR?.trim();
    if (dataDir) return resolve(dataDir);

    const metaUrl = options.metaUrl ?? import.meta.url;
    const cwd = options.cwd ?? process.cwd();
    const here = dirname(fileURLToPath(metaUrl));

    if (here === '/$bunfs' || here.startsWith('/$bunfs/')) {
        return resolve(cwd, 'server/data');
    }

    return join(here, '..', 'data');
}
