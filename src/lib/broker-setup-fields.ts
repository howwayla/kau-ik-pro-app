import type {
    BrokerName,
    BrokerSetupForm,
} from './broker-secret-payload';

export type BrokerSetupFieldKey = keyof BrokerSetupForm;

export interface BrokerSetupField {
    key: BrokerSetupFieldKey;
    label: string;
    type: 'text' | 'password';
    placeholder: string;
    required: boolean;
    advanced?: boolean;
}

export type BrokerSetupErrors = Partial<Record<BrokerSetupFieldKey, string>>;

export const BROKER_LABEL: Record<BrokerName, string> = {
    fubon: '富邦',
    nova: '台新',
    esun: '玉山',
};

export const BROKER_ACCOUNT_LABEL: Record<BrokerName, string> = {
    fubon: '身分證字號',
    nova: '身分證字號',
    esun: '證券帳號',
};

const FIELD_KEYS_BY_BROKER: Record<BrokerName, BrokerSetupFieldKey[]> = {
    fubon: ['idNo', 'password', 'apiKey', 'certPath', 'certPass'],
    nova: ['idNo', 'password', 'certPath', 'certPass', 'apiUrl'],
    esun: ['idNo', 'password', 'apiKey', 'apiSecret', 'certPath', 'certPass'],
};

export function emptyBrokerSetupForm(): BrokerSetupForm {
    return {
        idNo: '',
        password: '',
        apiKey: '',
        apiSecret: '',
        certPath: '',
        certPass: '',
        apiUrl: '',
    };
}

export function fieldsForBroker(broker: BrokerName): BrokerSetupField[] {
    return FIELD_KEYS_BY_BROKER[broker].map((key) => fieldForKey(broker, key));
}

export function validateBrokerSetupForm(
    broker: BrokerName,
    form: BrokerSetupForm,
): BrokerSetupErrors {
    const errors: BrokerSetupErrors = {};

    if (!value(form.idNo)) {
        errors.idNo = broker === 'esun' ? '請填證券帳號' : '請填身分證字號';
    }

    if (broker === 'fubon') {
        if (!value(form.password) && !value(form.apiKey)) {
            errors.password = '請填登入密碼或 API Key';
        }
    } else if (!value(form.password)) {
        errors.password = '請填登入密碼';
    }

    if (broker === 'esun') {
        if (!value(form.apiKey)) {
            errors.apiKey = '請填 API Key';
        }
        if (!value(form.apiSecret)) {
            errors.apiSecret = '請填 API Secret';
        }
    }

    if (!value(form.certPath)) {
        errors.certPath = '請選擇憑證檔';
    }

    if (!value(form.certPass)) {
        errors.certPass = '請填憑證密碼';
    }

    return errors;
}

export function brokerSetupSummary(broker: BrokerName, form: BrokerSetupForm) {
    const certificatePath = value(form.certPath);

    return {
        brokerLabel: BROKER_LABEL[broker],
        accountLabel: BROKER_ACCOUNT_LABEL[broker],
        accountValue: value(form.idNo),
        certificatePath,
        certificateFileName: certificatePath.split(/[\\/]/).pop() ?? '',
        apiUrl: value(form.apiUrl),
    };
}

function fieldForKey(
    broker: BrokerName,
    key: BrokerSetupFieldKey,
): BrokerSetupField {
    switch (key) {
        case 'idNo':
            return {
                key,
                label: BROKER_ACCOUNT_LABEL[broker],
                type: 'text',
                placeholder: `請填${BROKER_ACCOUNT_LABEL[broker]}`,
                required: true,
            };
        case 'password':
            return {
                key,
                label: '登入密碼',
                type: 'password',
                placeholder:
                    broker === 'fubon' ? '可填登入密碼或 API Key' : '請填登入密碼',
                required: broker !== 'fubon',
            };
        case 'apiKey':
            return {
                key,
                label: 'API Key',
                type: 'password',
                placeholder: '請填 API Key',
                required: broker === 'esun',
            };
        case 'apiSecret':
            return {
                key,
                label: 'API Secret',
                type: 'password',
                placeholder: '請填 API Secret',
                required: true,
            };
        case 'certPath':
            return {
                key,
                label: '憑證檔',
                type: 'text',
                placeholder: '請選擇憑證檔',
                required: true,
            };
        case 'certPass':
            return {
                key,
                label: '憑證密碼',
                type: 'password',
                placeholder: '請填憑證密碼',
                required: true,
            };
        case 'apiUrl':
            return {
                key,
                label: 'API URL',
                type: 'text',
                placeholder: '可選填 API URL',
                required: false,
                advanced: true,
            };
    }
}

function value(input: string | undefined): string {
    return (input ?? '').trim();
}
