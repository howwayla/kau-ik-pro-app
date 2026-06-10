// src/lib/runtime.ts — environment detection (zero dependencies; safe to
// import from anywhere without cycles)

export const isTauri =
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// In Tauri the frontend is served from tauri://localhost — API calls must
// target the local shioaji server explicitly.
export function getApiBase(): string {
    const env = import.meta.env.VITE_API_BASE as string | undefined;
    if (env) return env;
    return isTauri ? 'http://127.0.0.1:8080' : '';
}
