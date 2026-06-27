import {
    brokerSecretsFromSetupForm,
    type BrokerName,
    type BrokerSetupForm,
} from './broker-secret-payload';
import { isTauri } from './runtime';

const SECURE_STORAGE_DESKTOP_ONLY = '系統安全儲存只能在桌面 App 使用';

export interface BrokerSecretCommandResult {
    ok: boolean;
    present: boolean;
    error: string | null;
}

export type BrokerSecretInvokeCommand =
    | 'broker_secret_save'
    | 'broker_secret_status'
    | 'broker_secret_delete'
    | 'broker_secret_login'
    | 'broker_fresh_login';

export type BrokerSecretInvoker = <T>(
    command: BrokerSecretInvokeCommand,
    args: Record<string, unknown>,
) => Promise<T>;

export interface BrokerSavedMetadata {
    cert_path: string;
    api_url?: string | null;
}

export interface BrokerSecretLoginResult {
    ok: boolean;
    provider: BrokerName | null;
    market: string | null;
    warning: string | null;
    error: string | null;
}

function secureStorageFailure(action: string, result: BrokerSecretCommandResult) {
    return `${action}失敗：${result.error ?? '系統安全儲存無法使用'}`;
}

function ensureOk(action: string, result: BrokerSecretCommandResult) {
    if (!result.ok) throw new Error(secureStorageFailure(action, result));
}

async function invokeBrokerSecret<T>(
    command: BrokerSecretInvokeCommand,
    args: Record<string, unknown>,
): Promise<T> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(command, args);
}

export async function saveBrokerSecretsWithInvoke(
    invoke: BrokerSecretInvoker,
    broker: BrokerName,
    form: BrokerSetupForm,
): Promise<BrokerSecretCommandResult> {
    const result = await invoke<BrokerSecretCommandResult>('broker_secret_save', {
        broker,
        secrets: brokerSecretsFromSetupForm(form),
    });
    ensureOk('儲存券商登入資訊', result);
    return result;
}

export async function statusBrokerSecretsWithInvoke(
    invoke: BrokerSecretInvoker,
    broker: BrokerName,
): Promise<BrokerSecretCommandResult> {
    const result = await invoke<BrokerSecretCommandResult>(
        'broker_secret_status',
        { broker },
    );
    ensureOk('讀取券商登入狀態', result);
    return result;
}

export async function deleteBrokerSecretsWithInvoke(
    invoke: BrokerSecretInvoker,
    broker: BrokerName,
): Promise<BrokerSecretCommandResult> {
    const result = await invoke<BrokerSecretCommandResult>(
        'broker_secret_delete',
        { broker },
    );
    ensureOk('清除券商登入資訊', result);
    return result;
}

export async function loginBrokerWithSavedSecretsWithInvoke(
    invoke: BrokerSecretInvoker,
    broker: BrokerName,
    metadata: BrokerSavedMetadata,
): Promise<BrokerSecretLoginResult> {
    const result = await invoke<BrokerSecretLoginResult>('broker_secret_login', {
        broker,
        metadata: {
            certPath: metadata.cert_path,
            apiUrl: metadata.api_url ?? '',
        },
    });
    if (!result.ok) {
        throw new Error(
            `登入券商失敗：${result.error ?? '系統安全儲存無法使用'}`,
        );
    }
    return result;
}

export async function freshLoginBrokerWithInvoke(
    invoke: BrokerSecretInvoker,
    broker: BrokerName,
    form: BrokerSetupForm,
): Promise<BrokerSecretLoginResult> {
    const result = await invoke<BrokerSecretLoginResult>('broker_fresh_login', {
        broker,
        metadata: {
            certPath: form.certPath,
            apiUrl: form.apiUrl ?? '',
        },
        secrets: brokerSecretsFromSetupForm(form),
    });
    if (!result.ok) {
        throw new Error(
            `登入券商失敗：${result.error ?? '系統安全儲存無法使用'}`,
        );
    }
    return result;
}

export async function saveBrokerSecrets(
    broker: BrokerName,
    form: BrokerSetupForm,
): Promise<BrokerSecretCommandResult> {
    if (!isTauri) throw new Error('系統安全儲存只能在桌面 App 使用');
    return saveBrokerSecretsWithInvoke(invokeBrokerSecret, broker, form);
}

export async function loginBrokerWithSavedSecrets(
    broker: BrokerName,
    metadata: BrokerSavedMetadata,
): Promise<BrokerSecretLoginResult> {
    if (!isTauri) throw new Error(SECURE_STORAGE_DESKTOP_ONLY);
    return loginBrokerWithSavedSecretsWithInvoke(
        invokeBrokerSecret,
        broker,
        metadata,
    );
}

export async function freshLoginBroker(
    broker: BrokerName,
    form: BrokerSetupForm,
): Promise<BrokerSecretLoginResult> {
    if (!isTauri) throw new Error(SECURE_STORAGE_DESKTOP_ONLY);
    return freshLoginBrokerWithInvoke(invokeBrokerSecret, broker, form);
}

export async function statusBrokerSecrets(
    broker: BrokerName,
): Promise<BrokerSecretCommandResult> {
    if (!isTauri) {
        return { ok: false, present: false, error: 'not running in Tauri' };
    }
    return statusBrokerSecretsWithInvoke(invokeBrokerSecret, broker);
}

export async function deleteBrokerSecrets(
    broker: BrokerName,
): Promise<BrokerSecretCommandResult> {
    if (!isTauri) throw new Error('系統安全儲存只能在桌面 App 使用');
    return deleteBrokerSecretsWithInvoke(invokeBrokerSecret, broker);
}
