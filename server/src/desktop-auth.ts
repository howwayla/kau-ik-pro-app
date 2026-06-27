import { createHmac, timingSafeEqual } from 'node:crypto';

export const DESKTOP_AUTH_HEADER = 'x-kauik-desktop-auth';

export function desktopIdentitySignature(token: string, nonce: string): string {
    return createHmac('sha256', token).update(nonce).digest('hex');
}

export function verifyDesktopAuthHeader(
    header: string | undefined,
    token: string | undefined,
): boolean {
    if (!token || !header) return false;
    const expected = Buffer.from(token);
    const actual = Buffer.from(header);
    return (
        expected.length === actual.length &&
        timingSafeEqual(expected, actual)
    );
}
