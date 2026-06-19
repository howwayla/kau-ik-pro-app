import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(repoRoot, 'src');

async function findUiTestFiles(dir) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    const nestedFiles = await Promise.all(
        entries.map(async (entry) => {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) {
                return findUiTestFiles(path);
            }
            if (entry.isFile() && entry.name.endsWith('.test.ts')) {
                return [path];
            }
            return [];
        }),
    );

    return nestedFiles.flat();
}

const testFiles = (await findUiTestFiles(srcDir))
    .map((file) => relative(repoRoot, file))
    .sort();

if (testFiles.length === 0) {
    console.log('No frontend UI tests found under src/**/*.test.ts; skipping.');
    process.exit(0);
}

const label = testFiles.length === 1 ? 'file' : 'files';
console.log(`Running ${testFiles.length} frontend UI test ${label}.`);

const tsxCommand = process.platform === 'win32' ? 'tsx.cmd' : 'tsx';
const child = spawn(tsxCommand, ['--test', ...testFiles], {
    cwd: repoRoot,
    stdio: 'inherit',
});

child.on('error', (error) => {
    console.error(`Failed to start tsx: ${error.message}`);
    process.exit(1);
});

child.on('exit', (code, signal) => {
    if (signal) {
        console.error(`tsx exited after receiving ${signal}.`);
        process.exit(1);
    }
    process.exit(code ?? 1);
});
