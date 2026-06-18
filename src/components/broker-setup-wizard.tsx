import { useEffect, useMemo, useState } from 'react';
import {
    setDefaultTradeBroker,
    setTradeMetadata,
    setTradeSource,
} from '../lib/backend';
import {
    brokerMetadataFromSetupForm,
    type BrokerName,
    type BrokerSetupForm,
} from '../lib/broker-secret-payload';
import {
    deleteBrokerSecrets,
    saveBrokerSecrets,
} from '../lib/broker-secret-store';
import { chooseCertificateFile } from '../lib/broker-certificate-file';
import { isTauri } from '../lib/runtime';
import {
    BROKER_LABEL,
    brokerSetupSummary,
    emptyBrokerSetupForm,
    fieldsForBroker,
    validateBrokerSetupForm,
    type BrokerSetupErrors,
} from '../lib/broker-setup-fields';
import * as styles from './broker-setup-wizard.css';

export interface BrokerSetupWizardProps {
    open: boolean;
    initialBroker: BrokerName | null;
    configured: Record<BrokerName, boolean>;
    currentBroker: BrokerName | 'mock';
    onClose: () => void;
}

const BROKER_CHOICES: BrokerName[] = ['fubon', 'nova', 'esun'];
const STEP_LABELS = ['選券商', '填寫登入資訊', '檢查並登入'] as const;

export function BrokerSetupWizard({
    open,
    initialBroker,
    configured,
    currentBroker,
    onClose,
}: BrokerSetupWizardProps) {
    const [step, setStep] = useState(0);
    const [broker, setBroker] = useState<BrokerName | null>(null);
    const [form, setForm] = useState<BrokerSetupForm>(() =>
        emptyBrokerSetupForm(),
    );
    const [errors, setErrors] = useState<BrokerSetupErrors>({});
    const [busy, setBusy] = useState(false);
    const [submitError, setSubmitError] = useState('');
    const [makeDefault, setMakeDefault] = useState(false);

    useEffect(() => {
        if (!open) return;
        setStep(initialBroker ? 1 : 0);
        setBroker(initialBroker);
        setForm(emptyBrokerSetupForm());
        setErrors({});
        setBusy(false);
        setSubmitError('');
        setMakeDefault(false);
    }, [open, initialBroker]);

    const fields = useMemo(
        () => (broker ? fieldsForBroker(broker) : []),
        [broker],
    );
    const summary = useMemo(
        () => (broker ? brokerSetupSummary(broker, form) : null),
        [broker, form],
    );

    if (!open) return null;

    const updateField = (key: keyof BrokerSetupForm, value: string) => {
        setForm((current) => ({ ...current, [key]: value }));
        setErrors((current) => ({ ...current, [key]: undefined }));
        setSubmitError('');
    };

    const statusForBroker = (choice: BrokerName) => {
        if (currentBroker === choice) return '目前登入中';
        if (configured[choice]) return '已設定，可重新設定';
        return '未設定';
    };

    const goNextFromDetails = () => {
        if (!broker) return;
        const nextErrors = validateBrokerSetupForm(broker, form);
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) return;
        setSubmitError('');
        setStep(2);
    };

    const chooseCertificate = async () => {
        if (busy) return;
        try {
            const path = await chooseCertificateFile();
            if (path) updateField('certPath', path);
        } catch (e) {
            setSubmitError(e instanceof Error ? e.message : String(e));
        }
    };

    const submit = async () => {
        if (!broker || busy) return;

        const nextErrors = validateBrokerSetupForm(broker, form);
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) {
            setStep(1);
            return;
        }

        setBusy(true);
        setSubmitError('');

        let savedSecrets = false;

        try {
            const result = await setTradeSource({
                provider: broker,
                id_no: form.idNo,
                password: form.password,
                api_key: form.apiKey,
                api_secret: form.apiSecret,
                cert_path: form.certPath,
                cert_pass: form.certPass,
                api_url: form.apiUrl,
                persist_metadata: isTauri ? false : undefined,
            });

            if (isTauri) {
                try {
                    await saveBrokerSecrets(broker, form);
                    savedSecrets = true;
                    await setTradeMetadata(
                        brokerMetadataFromSetupForm(broker, form),
                    );
                } catch (storageError) {
                    if (savedSecrets) {
                        await deleteBrokerSecrets(broker).catch(() => null);
                    }
                    throw storageError;
                }
            }

            if (makeDefault) {
                await setDefaultTradeBroker(broker);
            }

            if (result.warning) {
                setSubmitError(`${result.warning}（5 秒後重新整理）`);
                setTimeout(() => window.location.reload(), 5000);
                return;
            }

            window.location.reload();
        } catch (e) {
            await setTradeSource({ provider: 'mock' }).catch(() => null);
            setSubmitError(e instanceof Error ? e.message : String(e));
            setBusy(false);
        }
    };

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div
                aria-modal='true'
                className={styles.dialog}
                role='dialog'
                onClick={(e) => e.stopPropagation()}
            >
                <div className={styles.header}>
                    <div>
                        <div className={styles.title}>券商登入設定</div>
                        <div className={styles.steps}>
                            {STEP_LABELS.map((label, index) => (
                                <span
                                    key={label}
                                    className={
                                        styles.step[
                                            step === index ? 'on' : 'off'
                                        ]
                                    }
                                >
                                    {index + 1}. {label}
                                </span>
                            ))}
                        </div>
                    </div>
                    <button
                        aria-label='關閉券商登入設定'
                        className={styles.closeButton}
                        type='button'
                        onClick={onClose}
                    >
                        X
                    </button>
                </div>

                <div className={styles.body}>
                    {step === 0 && (
                        <div className={styles.brokerGrid}>
                            {BROKER_CHOICES.map((choice) => (
                                <button
                                    key={choice}
                                    className={styles.brokerButton}
                                    aria-pressed={broker === choice}
                                    type='button'
                                    onClick={() => {
                                        setBroker(choice);
                                        setForm(emptyBrokerSetupForm());
                                        setErrors({});
                                        setSubmitError('');
                                    }}
                                >
                                    <strong>{BROKER_LABEL[choice]}</strong>
                                    <span>{statusForBroker(choice)}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {step === 1 && broker && (
                        <>
                            <div className={styles.fieldGrid}>
                                {fields.map((field) => (
                                    <label
                                        key={field.key}
                                        className={styles.field}
                                    >
                                        <span className={styles.label}>
                                            {field.label}
                                            {!field.required && '（選填）'}
                                        </span>
                                        {field.key === 'certPath' ? (
                                            <div className={styles.fileRow}>
                                                <input
                                                    className={styles.input}
                                                    type='text'
                                                    value={
                                                        form[field.key] ?? ''
                                                    }
                                                    placeholder={
                                                        field.placeholder
                                                    }
                                                    onChange={(e) =>
                                                        updateField(
                                                            field.key,
                                                            e.target.value,
                                                        )
                                                    }
                                                />
                                                <button
                                                    className={
                                                        styles.secondaryButton
                                                    }
                                                    disabled={busy}
                                                    type='button'
                                                    onClick={() =>
                                                        void chooseCertificate()
                                                    }
                                                >
                                                    選擇檔案
                                                </button>
                                            </div>
                                        ) : (
                                            <input
                                                className={styles.input}
                                                type={field.type}
                                                value={form[field.key] ?? ''}
                                                placeholder={field.placeholder}
                                                onChange={(e) =>
                                                    updateField(
                                                        field.key,
                                                        e.target.value,
                                                    )
                                                }
                                            />
                                        )}
                                        <span className={styles.errorText}>
                                            {errors[field.key] ?? ''}
                                        </span>
                                    </label>
                                ))}
                            </div>
                            <p className={styles.hint}>
                                登入資訊會存到系統安全儲存；設定檔只保存憑證檔位置等非敏感資料。
                            </p>
                        </>
                    )}

                    {step === 2 && broker && summary && (
                        <>
                            <div className={styles.summary}>
                                <div>
                                    <span>券商</span>
                                    <strong>{summary.brokerLabel}</strong>
                                </div>
                                <div>
                                    <span>{summary.accountLabel}</span>
                                    <strong>{summary.accountValue}</strong>
                                </div>
                                <div>
                                    <span>憑證檔</span>
                                    <strong>
                                        {summary.certificateFileName ||
                                            summary.certificatePath}
                                    </strong>
                                </div>
                                <div>
                                    <span>憑證位置</span>
                                    <strong>{summary.certificatePath}</strong>
                                </div>
                                {summary.apiUrl && (
                                    <div>
                                        <span>API URL</span>
                                        <strong>{summary.apiUrl}</strong>
                                    </div>
                                )}
                            </div>
                            <label className={styles.hint}>
                                <input
                                    type='checkbox'
                                    checked={makeDefault}
                                    onChange={(e) =>
                                        setMakeDefault(e.target.checked)
                                    }
                                />{' '}
                                以後開啟 App 時優先登入這家券商
                            </label>
                        </>
                    )}

                    {submitError && (
                        <div className={styles.errorText}>{submitError}</div>
                    )}
                </div>

                <div className={styles.footer}>
                    {step > 0 && (
                        <button
                            className={styles.secondaryButton}
                            type='button'
                            disabled={busy}
                            onClick={() => setStep(step - 1)}
                        >
                            上一步
                        </button>
                    )}
                    {step === 0 && (
                        <button
                            className={styles.primaryButton}
                            disabled={!broker}
                            type='button'
                            onClick={() => setStep(1)}
                        >
                            下一步
                        </button>
                    )}
                    {step === 1 && (
                        <button
                            className={styles.primaryButton}
                            disabled={busy}
                            type='button'
                            onClick={goNextFromDetails}
                        >
                            下一步
                        </button>
                    )}
                    {step === 2 && (
                        <button
                            className={styles.primaryButton}
                            disabled={busy}
                            type='button'
                            onClick={() => void submit()}
                        >
                            儲存並登入
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
