// src/lib/api.ts

import { getApiBase } from './runtime';

const base = getApiBase();

// surface the server's {detail} error message when present
// (fastify's default serializer uses {message} — accept both)
async function fail(res: Response): Promise<never> {
    let detail = '';
    try {
        const body = await res.json();
        detail = body?.detail ?? body?.message ?? '';
    } catch {
        // non-JSON error body
    }
    throw new Error(detail || `${res.status} ${res.statusText}`);
}

export async function apiGet<T>(path: string): Promise<T> {
    const res = await fetch(base + path);
    if (!res.ok) {
        await fail(res);
    }
    return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        await fail(res);
    }
    return res.json() as Promise<T>;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(base + path, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        await fail(res);
    }
    return res.json() as Promise<T>;
}
