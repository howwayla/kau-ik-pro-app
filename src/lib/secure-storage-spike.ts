import { isTauri } from './runtime';

export interface SecureStorageSpikeResult {
    ok: boolean;
    present: boolean;
    valueMatches: boolean | null;
    error: string | null;
}

export interface SecureStorageSpikeRun {
    ok: boolean;
    message: string;
    steps: {
        write?: SecureStorageSpikeResult;
        read?: SecureStorageSpikeResult;
        cleanup?: SecureStorageSpikeResult;
    };
}

type SecureStorageSpikeCommand =
    | 'secure_storage_spike_write'
    | 'secure_storage_spike_read'
    | 'secure_storage_spike_delete';

async function invokeSpike(
    command: SecureStorageSpikeCommand,
): Promise<SecureStorageSpikeResult> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<SecureStorageSpikeResult>(command);
}

function failureMessage(
    action: string,
    result: SecureStorageSpikeResult,
): string {
    return `${action}失敗：${result.error ?? '系統安全儲存無法使用'}`;
}

export async function runSecureStorageSpike(): Promise<SecureStorageSpikeRun> {
    if (!isTauri) {
        return {
            ok: false,
            message: '安全儲存只能在桌面 App 裡測試',
            steps: {},
        };
    }

    const write = await invokeSpike('secure_storage_spike_write');
    if (!write.ok) {
        return {
            ok: false,
            message: failureMessage('寫入', write),
            steps: { write },
        };
    }

    const read = await invokeSpike('secure_storage_spike_read');
    if (!read.ok) {
        await invokeSpike('secure_storage_spike_delete').catch(() => null);
        return {
            ok: false,
            message: failureMessage('讀取', read),
            steps: { write, read },
        };
    }
    if (!read.present || read.valueMatches !== true) {
        await invokeSpike('secure_storage_spike_delete').catch(() => null);
        return {
            ok: false,
            message: '安全儲存讀回的資料不符合預期',
            steps: { write, read },
        };
    }

    const cleanup = await invokeSpike('secure_storage_spike_delete');
    if (!cleanup.ok) {
        return {
            ok: false,
            message: failureMessage('清理', cleanup),
            steps: { write, read, cleanup },
        };
    }

    return {
        ok: true,
        message: '系統安全儲存可用，測試資料已清理',
        steps: { write, read, cleanup },
    };
}
