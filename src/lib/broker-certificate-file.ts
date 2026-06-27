import { isTauri } from './runtime';

export interface CertificateDialogOptions {
    multiple: false;
    directory: false;
    filters: { name: string; extensions: string[] }[];
}

export type CertificateDialogSelection = string | string[] | null;

export type CertificateDialogOpen = (
    options: CertificateDialogOptions,
) => Promise<CertificateDialogSelection>;

export function normalizeCertificateSelection(
    selection: CertificateDialogSelection,
): string | null {
    if (Array.isArray(selection)) return selection[0] ?? null;
    return selection;
}

export async function chooseCertificateFileWithOpen(
    open: CertificateDialogOpen,
): Promise<string | null> {
    const selection = await open({
        multiple: false,
        directory: false,
        filters: [
            {
                name: 'Broker certificate',
                extensions: ['p12', 'pfx'],
            },
        ],
    });
    return normalizeCertificateSelection(selection);
}

export async function chooseCertificateFile(): Promise<string | null> {
    if (!isTauri) return null;
    const { open } = await import('@tauri-apps/plugin-dialog');
    return chooseCertificateFileWithOpen(open);
}
