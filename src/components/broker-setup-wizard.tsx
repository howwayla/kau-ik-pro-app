import { useEffect, useMemo, useRef, useState } from 'react';
import {
    fetchTradeConfig,
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
    statusBrokerSecrets,
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
import {
    applyEsunConfigToForm,
    isAbsoluteCertificatePath,
    parseEsunConfigIni,
} from '../lib/esun-config-import';
import * as styles from './broker-setup-wizard.css';

export interface BrokerSetupWizardProps {
    open: boolean;
    initialBroker: BrokerName | null;
    initialError?: string;
    configured: Record<BrokerName, boolean>;
    currentBroker: BrokerName | 'mock';
    onClose: () => void;
}

const BROKER_CHOICES: BrokerName[] = ['fubon', 'nova', 'esun'];
const STEP_LABELS = ['選券商', '填寫登入資訊', '檢查並登入'] as const;
const TITLE_ID = 'broker-setup-wizard-title';

export function BrokerSetupWizard({
    open,
    initialBroker,
    initialError = '',
    configured,
    currentBroker,
    onClose,
}: BrokerSetupWizardProps) {
    const [step, setStep] = useState(initialBroker ? 1 : 0);
    const [broker, setBroker] = useState<BrokerName | null>(initialBroker);
    const [form, setForm] = useState<BrokerSetupForm>(() =>
        emptyBrokerSetupForm(),
    );
    const [errors, setErrors] = useState<BrokerSetupErrors>({});
    const [busy, setBusy] = useState(false);
    const [submitError, setSubmitError] = useState(initialError);
    const [makeDefault, setMakeDefault] = useState(false);
    const [esunConfigStatus, setEsunConfigStatus] = useState('');
    const esunConfigInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!open) return;
        setStep(initialBroker ? 1 : 0);
        setBroker(initialBroker);
        setForm(emptyBrokerSetupForm());
        setErrors({});
        setBusy(false);
        setSubmitError(initialError);
        setMakeDefault(false);
        setEsunConfigStatus('');
    }, [open, initialBroker, initialError]);

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

    const importEsunConfig = async (file: File | null | undefined) => {
        if (!file) return;

        try {
            const parsed = parseEsunConfigIni(await file.text());
            setForm((current) => applyEsunConfigToForm(current, parsed));
            setErrors((current) => ({
                ...current,
                idNo: undefined,
                apiKey: undefined,
                apiSecret: undefined,
                apiUrl: undefined,
            }));
            setSubmitError('');

            const certNote =
                parsed.certPath &&
                !isAbsoluteCertificatePath(parsed.certPath)
                    ? '，請再選擇憑證檔'
                    : '';
            setEsunConfigStatus(`已讀取 ${file.name}${certNote}`);
        } catch (e) {
            setEsunConfigStatus('');
            setSubmitError(e instanceof Error ? e.message : String(e));
        } finally {
            if (esunConfigInputRef.current) {
                esunConfigInputRef.current.value = '';
            }
        }
    };

    const reloadAfterWarning = (warning: string) => {
        setSubmitError(`${warning}（5 秒後重新整理）`);
        setTimeout(() => window.location.reload(), 5000);
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

        let liveSwitchSucceeded = false;

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
            liveSwitchSucceeded = true;

            if (isTauri) {
                const previousMetadata = (await fetchTradeConfig()).metadata[
                    broker
                ];
                const existingSecrets = await statusBrokerSecrets(broker).catch(
                    () => null,
                );
                const nextMetadata = brokerMetadataFromSetupForm(broker, form);

                if (previousMetadata) {
                    await setTradeMetadata(nextMetadata);
                    try {
                        await saveBrokerSecrets(broker, form);
                    } catch (storageError) {
                        await setTradeMetadata({
                            provider: broker,
                            cert_path: previousMetadata.cert_path,
                            api_url: previousMetadata.api_url,
                        }).catch(() => null);
                        throw storageError;
                    }
                } else {
                    let savedSecrets = false;
                    try {
                        await saveBrokerSecrets(broker, form);
                        savedSecrets = true;
                        await setTradeMetadata(nextMetadata);
                    } catch (storageError) {
                        if (
                            savedSecrets &&
                            existingSecrets?.present === false
                        ) {
                            await deleteBrokerSecrets(broker).catch(() => null);
                        }
                        throw storageError;
                    }
                }
            }

            const warnings: string[] = [];
            if (result.warning) warnings.push(result.warning);

            if (makeDefault) {
                try {
                    await setDefaultTradeBroker(broker);
                } catch (defaultError) {
                    const message =
                        defaultError instanceof Error
                            ? defaultError.message
                            : String(defaultError);
                    warnings.push(
                        `登入完成，但預設券商偏好未儲存：${message}`,
                    );
                }
            }

            if (warnings.length > 0) {
                reloadAfterWarning(warnings.join('；'));
                return;
            }

            window.location.reload();
        } catch (e) {
            if (liveSwitchSucceeded) {
                await setTradeSource({ provider: 'mock' }).catch(() => null);
            }
            setSubmitError(e instanceof Error ? e.message : String(e));
            setBusy(false);
        }
    };

    return (
        <div
            className={styles.overlay}
            onClick={() => {
                if (!busy) onClose();
            }}
        >
            <div
                aria-labelledby={TITLE_ID}
                aria-modal='true'
                className={styles.dialog}
                role='dialog'
                onClick={(e) => e.stopPropagation()}
            >
                <div className={styles.header}>
                    <div>
                        <div className={styles.title} id={TITLE_ID}>
                            券商登入設定
                        </div>
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
                        disabled={busy}
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
                                        setEsunConfigStatus('');
                                        setStep(1);
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
                            {broker === 'esun' && (
                                <div className={styles.importPanel}>
                                    <input
                                        ref={esunConfigInputRef}
                                        accept='.ini,.example'
                                        className={styles.hiddenFileInput}
                                        type='file'
                                        onChange={(e) =>
                                            void importEsunConfig(
                                                e.currentTarget.files?.[0],
                                            )
                                        }
                                    />
                                    <div className={styles.importRow}>
                                        <div className={styles.importCopy}>
                                            <strong>匯入玉山設定檔</strong>
                                            <span>
                                                選擇 config.ini 或
                                                config.simulation.ini.example
                                            </span>
                                        </div>
                                        <button
                                            className={styles.secondaryButton}
                                            disabled={busy}
                                            type='button'
                                            onClick={() =>
                                                esunConfigInputRef.current?.click()
                                            }
                                        >
                                            匯入設定檔
                                        </button>
                                    </div>
                                    <span
                                        className={
                                            esunConfigStatus
                                                ? styles.successText
                                                : styles.errorText
                                        }
                                    >
                                        {esunConfigStatus || errors.apiKey || ''}
                                    </span>
                                </div>
                            )}
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
