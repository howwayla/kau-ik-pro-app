import type { BrokerSetupForm } from './broker-secret-payload';

export interface EsunConfigImport {
    apiUrl: string;
    apiKey: string;
    apiSecret: string;
    idNo: string;
    certPath: string;
}

type IniSections = Record<string, Record<string, string>>;

const REQUIRED_FIELDS = [
    ['Core', 'Entry', 'apiUrl'],
    ['Api', 'Key', 'apiKey'],
    ['Api', 'Secret', 'apiSecret'],
    ['User', 'Account', 'idNo'],
] as const;

export function parseEsunConfigIni(text: string): EsunConfigImport {
    const sections = parseIni(text);
    const parsed = {
        apiUrl: readRequired(sections, 'Core', 'Entry'),
        apiKey: readRequired(sections, 'Api', 'Key'),
        apiSecret: readRequired(sections, 'Api', 'Secret'),
        idNo: readRequired(sections, 'User', 'Account'),
        certPath: readOptional(sections, 'Cert', 'Path'),
    };

    return parsed;
}

export function applyEsunConfigToForm(
    form: BrokerSetupForm,
    config: EsunConfigImport,
): BrokerSetupForm {
    return {
        ...form,
        idNo: config.idNo,
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
        apiUrl: config.apiUrl,
        certPath: isAbsoluteCertificatePath(config.certPath)
            ? config.certPath
            : form.certPath,
    };
}

export function isAbsoluteCertificatePath(path: string): boolean {
    const trimmed = path.trim();
    return (
        trimmed.startsWith('/') ||
        trimmed.startsWith('\\\\') ||
        /^[A-Za-z]:[\\/]/.test(trimmed)
    );
}

function parseIni(text: string): IniSections {
    const sections: IniSections = {};
    let section = '';

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/^\uFEFF/, '').trim();
        if (!line || line.startsWith(';') || line.startsWith('#')) continue;

        const sectionMatch = stripInlineComment(line).match(/^\[([^\]]+)\]$/);
        if (sectionMatch) {
            section = normalize(sectionMatch[1] ?? '');
            sections[section] ??= {};
            continue;
        }

        const equalsAt = line.indexOf('=');
        if (!section || equalsAt < 0) continue;

        const key = normalize(line.slice(0, equalsAt));
        const value = cleanIniValue(line.slice(equalsAt + 1));
        const currentSection = (sections[section] ??= {});
        currentSection[key] = value;
    }

    return sections;
}

function readRequired(
    sections: IniSections,
    section: (typeof REQUIRED_FIELDS)[number][0],
    key: (typeof REQUIRED_FIELDS)[number][1],
): string {
    const value = readOptional(sections, section, key);
    if (value) return value;
    throw new Error(`玉山設定檔缺少 [${section}] ${key}`);
}

function readOptional(
    sections: IniSections,
    section: string,
    key: string,
): string {
    return sections[normalize(section)]?.[normalize(key)]?.trim() ?? '';
}

function cleanIniValue(input: string): string {
    let value = input.trim();
    if (value.startsWith(';') || value.startsWith('#')) return '';

    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.slice(1, -1).trim();
    }

    value = stripInlineComment(value);
    return value;
}

function stripInlineComment(input: string): string {
    return input.replace(/\s+[;#].*$/, '').trim();
}

function normalize(input: string): string {
    return input.trim().toLowerCase();
}
