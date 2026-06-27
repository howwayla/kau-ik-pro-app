# Broker Setup Wizard PR2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a modal broker setup wizard that lets non-technical desktop users configure Fubon, Taishin, and Esun with certificate file picking and metadata-only persistence.

**Architecture:** Keep PR1 secure-storage behavior intact and move the setup experience out of the header popover into a dedicated React modal. Put broker-specific form definitions and validation in pure helpers, put certificate picking behind a small Tauri dialog wrapper, and persist the optional default-login preference through the existing runtime config route layer as non-secret metadata.

**Tech Stack:** React 19, TypeScript, vanilla-extract, Tauri 2, `@tauri-apps/plugin-dialog`, `tauri-plugin-dialog`, Fastify route tests with `tsx`, Node `--test`.

---

## File Structure

- Create `src/lib/broker-setup-fields.ts`: broker labels, field definitions, empty form creation, validation, and non-secret summary helpers.
- Create `scripts/broker-setup-fields.test.ts`: tests for field visibility, validation, and secret-safe summaries.
- Create `src/lib/broker-certificate-file.ts`: wrapper around the Tauri dialog plugin for `.p12` / `.pfx` certificate selection.
- Create `scripts/broker-certificate-file.test.ts`: tests for dialog invocation and path normalization.
- Modify `src/lib/backend.ts`: add `default_broker` to `TradeConfig` and `setDefaultTradeBroker()`.
- Modify `server/src/runtime-config.ts`: persist optional `defaultTradeBroker` as non-secret config.
- Modify `server/src/runtime-config.test.ts`: verify default broker persistence does not include secrets.
- Modify `server/src/routes/config.ts`: expose and update `default_broker`.
- Modify `server/src/routes/config-metadata.test.ts`: route tests for default broker preference.
- Modify `package.json`: include new script tests and add `@tauri-apps/plugin-dialog`.
- Modify `src-tauri/Cargo.toml`: add `tauri-plugin-dialog = "2"`.
- Modify `src-tauri/src/lib.rs`: initialize the dialog plugin.
- Modify `src-tauri/capabilities/default.json`: add dialog permissions.
- Create `src/components/broker-setup-wizard.tsx`: modal shell, step state, fields, certificate picker, and submit orchestration.
- Create `src/components/broker-setup-wizard.css.ts`: modal-specific styles.
- Modify `src/components/hud-header.tsx`: keep broker menu compact and open the wizard instead of rendering the long form inline.

## Task 1: Broker Setup Field Model And Validation

**Files:**
- Create: `scripts/broker-setup-fields.test.ts`
- Create: `src/lib/broker-setup-fields.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing tests**

Create `scripts/broker-setup-fields.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    brokerSetupSummary,
    emptyBrokerSetupForm,
    fieldsForBroker,
    validateBrokerSetupForm,
} from '../src/lib/broker-setup-fields.ts';
import type { BrokerSetupForm } from '../src/lib/broker-secret-payload.ts';

function filled(overrides: Partial<BrokerSetupForm> = {}): BrokerSetupForm {
    return {
        idNo: 'A123456789',
        password: 'account-pass',
        apiKey: 'api-key',
        apiSecret: 'api-secret',
        certPath: '/private/certs/fubon.p12',
        certPass: 'cert-pass',
        apiUrl: '',
        ...overrides,
    };
}

test('fieldsForBroker shows only broker-specific fields', () => {
    assert.deepEqual(
        fieldsForBroker('fubon').map((field) => field.key),
        ['idNo', 'password', 'apiKey', 'certPath', 'certPass'],
    );
    assert.deepEqual(
        fieldsForBroker('nova').map((field) => field.key),
        ['idNo', 'password', 'certPath', 'certPass', 'apiUrl'],
    );
    assert.deepEqual(
        fieldsForBroker('esun').map((field) => field.key),
        ['idNo', 'password', 'apiKey', 'apiSecret', 'certPath', 'certPass'],
    );
});

test('validateBrokerSetupForm allows Fubon password or API key', () => {
    assert.deepEqual(validateBrokerSetupForm('fubon', filled({ apiKey: '' })), {});
    assert.deepEqual(
        validateBrokerSetupForm('fubon', filled({ password: '', apiKey: 'api-key' })),
        {},
    );
    assert.equal(
        validateBrokerSetupForm('fubon', filled({ password: '', apiKey: '' })).password,
        '請填登入密碼或 API Key',
    );
});

test('validateBrokerSetupForm requires Esun API key and secret', () => {
    const errors = validateBrokerSetupForm(
        'esun',
        filled({ apiKey: '', apiSecret: '' }),
    );

    assert.equal(errors.apiKey, '請填 API Key');
    assert.equal(errors.apiSecret, '請填 API Secret');
});

test('validateBrokerSetupForm requires certificate path and password', () => {
    const errors = validateBrokerSetupForm(
        'nova',
        filled({ certPath: '', certPass: '' }),
    );

    assert.equal(errors.certPath, '請選擇憑證檔');
    assert.equal(errors.certPass, '請填憑證密碼');
});

test('brokerSetupSummary does not expose secret values', () => {
    const summary = brokerSetupSummary('esun', filled());
    const text = JSON.stringify(summary);

    assert.deepEqual(summary, {
        brokerLabel: '玉山',
        accountLabel: '證券帳號',
        accountValue: 'A123456789',
        certificatePath: '/private/certs/fubon.p12',
        certificateFileName: 'fubon.p12',
        apiUrl: '',
    });
    for (const value of ['account-pass', 'api-key', 'api-secret', 'cert-pass']) {
        assert.equal(text.includes(value), false, `${value} leaked`);
    }
});

test('emptyBrokerSetupForm has all form keys', () => {
    assert.deepEqual(emptyBrokerSetupForm(), {
        idNo: '',
        password: '',
        apiKey: '',
        apiSecret: '',
        certPath: '',
        certPass: '',
        apiUrl: '',
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```sh
pnpm exec tsx --test scripts/broker-setup-fields.test.ts
```

Expected: failure because `src/lib/broker-setup-fields.ts` does not exist.

- [ ] **Step 3: Implement the field helper**

Create `src/lib/broker-setup-fields.ts`:

```ts
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

const COMMON_CERT_FIELDS: BrokerSetupField[] = [
    {
        key: 'certPath',
        label: '憑證檔位置',
        type: 'text',
        placeholder: '選擇 .p12 / .pfx 憑證檔',
        required: true,
    },
    {
        key: 'certPass',
        label: '憑證密碼',
        type: 'password',
        placeholder: '輸入憑證密碼',
        required: true,
    },
];

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
    if (broker === 'fubon') {
        return [
            {
                key: 'idNo',
                label: BROKER_ACCOUNT_LABEL.fubon,
                type: 'text',
                placeholder: '例：A123456789',
                required: true,
            },
            {
                key: 'password',
                label: '登入密碼',
                type: 'password',
                placeholder: '可與 API Key 擇一',
                required: false,
            },
            {
                key: 'apiKey',
                label: 'API Key',
                type: 'password',
                placeholder: '可與登入密碼擇一',
                required: false,
            },
            ...COMMON_CERT_FIELDS,
        ];
    }
    if (broker === 'nova') {
        return [
            {
                key: 'idNo',
                label: BROKER_ACCOUNT_LABEL.nova,
                type: 'text',
                placeholder: '例：A123456789',
                required: true,
            },
            {
                key: 'password',
                label: '登入密碼',
                type: 'password',
                placeholder: '輸入台新證券登入密碼',
                required: true,
            },
            ...COMMON_CERT_FIELDS,
            {
                key: 'apiUrl',
                label: 'API URL',
                type: 'text',
                placeholder: '通常不需要填寫',
                required: false,
                advanced: true,
            },
        ];
    }
    return [
        {
            key: 'idNo',
            label: BROKER_ACCOUNT_LABEL.esun,
            type: 'text',
            placeholder: '例：884 開頭帳號',
            required: true,
        },
        {
            key: 'password',
            label: '登入密碼',
            type: 'password',
            placeholder: '輸入玉山證券登入密碼',
            required: true,
        },
        {
            key: 'apiKey',
            label: 'API Key',
            type: 'password',
            placeholder: '輸入玉山 API Key',
            required: true,
        },
        {
            key: 'apiSecret',
            label: 'API Secret',
            type: 'password',
            placeholder: '輸入玉山 API Secret',
            required: true,
        },
        ...COMMON_CERT_FIELDS,
    ];
}

function present(value: string | undefined): boolean {
    return Boolean(value?.trim());
}

export function validateBrokerSetupForm(
    broker: BrokerName,
    form: BrokerSetupForm,
): BrokerSetupErrors {
    const errors: BrokerSetupErrors = {};
    if (!present(form.idNo)) {
        errors.idNo =
            broker === 'esun' ? '請填證券帳號' : '請填身分證字號';
    }
    if (broker === 'fubon') {
        if (!present(form.password) && !present(form.apiKey)) {
            errors.password = '請填登入密碼或 API Key';
        }
    } else if (!present(form.password)) {
        errors.password = '請填登入密碼';
    }
    if (broker === 'esun') {
        if (!present(form.apiKey)) errors.apiKey = '請填 API Key';
        if (!present(form.apiSecret)) errors.apiSecret = '請填 API Secret';
    }
    if (!present(form.certPath)) errors.certPath = '請選擇憑證檔';
    if (!present(form.certPass)) errors.certPass = '請填憑證密碼';
    return errors;
}

function fileName(path: string): string {
    return path.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
}

export function brokerSetupSummary(broker: BrokerName, form: BrokerSetupForm) {
    return {
        brokerLabel: BROKER_LABEL[broker],
        accountLabel: BROKER_ACCOUNT_LABEL[broker],
        accountValue: form.idNo.trim(),
        certificatePath: form.certPath.trim(),
        certificateFileName: fileName(form.certPath.trim()),
        apiUrl: form.apiUrl?.trim() ?? '',
    };
}
```

- [ ] **Step 4: Verify helper tests pass**

Run:

```sh
pnpm exec tsx --test scripts/broker-setup-fields.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Add the test to the root test script**

Modify `package.json` so the root `test` script includes:

```sh
pnpm exec tsx --test scripts/broker-secret-payload.test.ts scripts/broker-secret-store.test.ts scripts/broker-setup-fields.test.ts
```

- [ ] **Step 6: Commit**

Run:

```sh
git add package.json scripts/broker-setup-fields.test.ts src/lib/broker-setup-fields.ts
git commit -m "test: add broker setup field model"
```

## Task 2: Default Broker Preference API

**Files:**
- Modify: `server/src/runtime-config.ts`
- Modify: `server/src/runtime-config.test.ts`
- Modify: `server/src/routes/config.ts`
- Modify: `server/src/routes/config-metadata.test.ts`
- Modify: `src/lib/backend.ts`

- [ ] **Step 1: Write failing runtime-config tests**

Append to `server/src/runtime-config.test.ts` before the final `console.log`:

```ts
await check('persists defaultTradeBroker without broker secrets', () => {
    const filePath = tempConfigPath();
    const store = new RuntimeConfigStore(filePath);

    store.set({
        defaultTradeBroker: 'nova',
        brokerCreds: { fubon: fubonCreds },
    });

    const persisted = JSON.parse(readFileSync(filePath, 'utf8'));

    assert.equal(persisted.defaultTradeBroker, 'nova');
    assert.equal(Object.hasOwn(persisted, 'brokerCreds'), false);
    assert.equal(JSON.stringify(persisted).includes('account-pass'), false);
});

await check('defaults defaultTradeBroker to null', () => {
    const store = new RuntimeConfigStore(tempConfigPath());

    assert.equal(store.get().defaultTradeBroker, null);
});
```

- [ ] **Step 2: Verify runtime-config tests fail**

Run:

```sh
pnpm --filter kau-ik-pro-server exec tsx src/runtime-config.test.ts
```

Expected: failure because `defaultTradeBroker` is not in `RuntimeConfig`.

- [ ] **Step 3: Implement defaultTradeBroker in runtime config**

In `server/src/runtime-config.ts`, add the field:

```ts
export interface RuntimeConfig {
    marketProvider: 'mock' | 'fugle';
    fugleApiKey: string;
    tradeProvider: TradeProviderName;
    defaultTradeBroker: BrokerKey | null;
    brokerMetadata: Partial<Record<BrokerKey, BrokerMetadata>>;
    brokerCreds: Partial<Record<BrokerKey, BrokerCreds>>;
}
```

In the constructor config object, add:

```ts
defaultTradeBroker:
    loaded.defaultTradeBroker === 'fubon' ||
    loaded.defaultTradeBroker === 'nova' ||
    loaded.defaultTradeBroker === 'esun'
        ? loaded.defaultTradeBroker
        : null,
```

In `persistedConfig`, add:

```ts
defaultTradeBroker: config.defaultTradeBroker,
```

- [ ] **Step 4: Verify runtime-config tests pass**

Run:

```sh
pnpm --filter kau-ik-pro-server exec tsx src/runtime-config.test.ts
```

Expected: `ALL GREEN`.

- [ ] **Step 5: Write failing route tests**

Append to `server/src/routes/config-metadata.test.ts` before the final `console.log`:

```ts
await check('GET /api/v1/config/trade exposes default broker preference', async () => {
    const runtimeConfig = new RuntimeConfigStore(tempConfigPath());
    runtimeConfig.set({ defaultTradeBroker: 'esun' });
    const app = buildTestApp(runtimeConfig);

    const res = await app.inject({
        method: 'GET',
        url: '/api/v1/config/trade',
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().default_broker, 'esun');
});

await check('POST /api/v1/config/trade/default persists default broker preference', async () => {
    const filePath = tempConfigPath();
    const runtimeConfig = new RuntimeConfigStore(filePath);
    const app = buildTestApp(runtimeConfig);

    const res = await app.inject({
        method: 'POST',
        url: '/api/v1/config/trade/default',
        payload: { provider: 'fubon' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(runtimeConfig.get().defaultTradeBroker, 'fubon');
    const persistedText = readFileSync(filePath, 'utf8');
    assert.ok(persistedText.includes('defaultTradeBroker'));
    assert.equal(persistedText.includes('password'), false);
});

await check('POST /api/v1/config/trade/default clears default broker preference', async () => {
    const runtimeConfig = new RuntimeConfigStore(tempConfigPath());
    runtimeConfig.set({ defaultTradeBroker: 'fubon' });
    const app = buildTestApp(runtimeConfig);

    const res = await app.inject({
        method: 'POST',
        url: '/api/v1/config/trade/default',
        payload: { provider: null },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(runtimeConfig.get().defaultTradeBroker, null);
});
```

- [ ] **Step 6: Verify route tests fail**

Run:

```sh
pnpm --filter kau-ik-pro-server exec tsx src/routes/config-metadata.test.ts
```

Expected: failures because `default_broker` and `/api/v1/config/trade/default` do not exist.

- [ ] **Step 7: Implement route and frontend API types**

In `server/src/routes/config.ts`, add `default_broker` to GET `/api/v1/config/trade`:

```ts
default_broker: ctx.runtimeConfig.get().defaultTradeBroker,
```

Add this route before the existing `POST /api/v1/config/trade` route:

```ts
app.post<{
    Body: {
        provider?: 'fubon' | 'nova' | 'esun' | null;
    };
}>('/api/v1/config/trade/default', async (req, reply) => {
    const name = req.body?.provider ?? null;
    if (name !== null && !['fubon', 'nova', 'esun'].includes(name)) {
        return reply
            .code(400)
            .send({ detail: 'provider 需為 fubon | nova | esun | null' });
    }
    ctx.runtimeConfig.set({ defaultTradeBroker: name });
    return { default_broker: name };
});
```

In `src/lib/backend.ts`, update `TradeConfig`:

```ts
default_broker: Exclude<TradeProviderName, 'mock'> | null;
```

Add:

```ts
export function setDefaultTradeBroker(
    provider: Exclude<TradeProviderName, 'mock'> | null,
) {
    return apiPost<{ default_broker: Exclude<TradeProviderName, 'mock'> | null }>(
        '/api/v1/config/trade/default',
        { provider },
    );
}
```

- [ ] **Step 8: Verify route and type checks pass**

Run:

```sh
pnpm --filter kau-ik-pro-server exec tsx src/routes/config-metadata.test.ts
pnpm --filter kau-ik-pro-server run typecheck
pnpm build
```

Expected: route tests pass; typechecks pass.

- [ ] **Step 9: Commit**

Run:

```sh
git add server/src/runtime-config.ts server/src/runtime-config.test.ts server/src/routes/config.ts server/src/routes/config-metadata.test.ts src/lib/backend.ts
git commit -m "feat: persist default broker preference"
```

## Task 3: Certificate File Picker Wrapper

**Files:**
- Create: `scripts/broker-certificate-file.test.ts`
- Create: `src/lib/broker-certificate-file.ts`
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Write the failing tests**

Create `scripts/broker-certificate-file.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    chooseCertificateFileWithOpen,
    normalizeCertificateSelection,
} from '../src/lib/broker-certificate-file.ts';

test('normalizeCertificateSelection accepts a single path', () => {
    assert.equal(
        normalizeCertificateSelection('/private/certs/fubon.p12'),
        '/private/certs/fubon.p12',
    );
});

test('normalizeCertificateSelection accepts the first selected path', () => {
    assert.equal(
        normalizeCertificateSelection(['/private/certs/fubon.pfx']),
        '/private/certs/fubon.pfx',
    );
});

test('normalizeCertificateSelection returns null for cancel', () => {
    assert.equal(normalizeCertificateSelection(null), null);
    assert.equal(normalizeCertificateSelection([]), null);
});

test('chooseCertificateFileWithOpen opens a certificate-only dialog', async () => {
    const calls: unknown[] = [];
    const selected = await chooseCertificateFileWithOpen(async (options) => {
        calls.push(options);
        return '/private/certs/nova.p12';
    });

    assert.equal(selected, '/private/certs/nova.p12');
    assert.deepEqual(calls, [
        {
            multiple: false,
            directory: false,
            filters: [
                {
                    name: 'Broker certificate',
                    extensions: ['p12', 'pfx'],
                },
            ],
        },
    ]);
});
```

- [ ] **Step 2: Verify tests fail**

Run:

```sh
pnpm exec tsx --test scripts/broker-certificate-file.test.ts
```

Expected: failure because `src/lib/broker-certificate-file.ts` does not exist.

- [ ] **Step 3: Add the Tauri dialog dependencies**

Run:

```sh
pnpm add @tauri-apps/plugin-dialog
```

Then add to `src-tauri/Cargo.toml` dependencies:

```toml
tauri-plugin-dialog = "2"
```

- [ ] **Step 4: Implement the file picker wrapper**

Create `src/lib/broker-certificate-file.ts`:

```ts
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
```

- [ ] **Step 5: Register the dialog plugin**

In `src-tauri/src/lib.rs`, add the plugin to the builder chain:

```rust
.plugin(tauri_plugin_dialog::init())
```

Place it near the other `.plugin(...)` calls.

In `src-tauri/capabilities/default.json`, add:

```json
"dialog:default",
"dialog:allow-open"
```

Add both strings to the existing `permissions` array.

- [ ] **Step 6: Add the test to the root test script**

Modify `package.json` so the root `test` script includes:

```sh
pnpm exec tsx --test scripts/broker-secret-payload.test.ts scripts/broker-secret-store.test.ts scripts/broker-setup-fields.test.ts scripts/broker-certificate-file.test.ts
```

- [ ] **Step 7: Verify tests and Rust compile checks pass**

Run:

```sh
pnpm exec tsx --test scripts/broker-certificate-file.test.ts
pnpm test
cargo check --manifest-path src-tauri/Cargo.toml
pnpm build
```

Expected: all commands pass.

- [ ] **Step 8: Commit**

Run:

```sh
git add package.json pnpm-lock.yaml scripts/broker-certificate-file.test.ts src/lib/broker-certificate-file.ts src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat: add broker certificate file picker"
```

## Task 4: Broker Setup Wizard Modal

**Files:**
- Create: `src/components/broker-setup-wizard.tsx`
- Create: `src/components/broker-setup-wizard.css.ts`
- Modify: `src/components/hud-header.tsx`

- [ ] **Step 1: Create the wizard styles**

Create `src/components/broker-setup-wizard.css.ts`:

```ts
import { style, styleVariants } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const overlay = style({
    position: 'fixed',
    inset: 0,
    zIndex: 2200,
    background: 'rgba(0, 0, 0, 0.48)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: vars.space.lg,
});

export const dialog = style({
    width: 'min(46rem, calc(100vw - 32px))',
    maxHeight: 'min(42rem, calc(100vh - 32px))',
    overflow: 'hidden',
    background: vars.color.panelRaised,
    border: `1px solid ${vars.color.borderBright}`,
    borderRadius: vars.radius.lg,
    boxShadow: '0 24px 72px rgba(0, 0, 0, 0.52)',
    display: 'flex',
    flexDirection: 'column',
});

export const header = style({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: vars.space.md,
    padding: `${vars.space.md} ${vars.space.lg}`,
    borderBottom: `1px solid ${vars.color.border}`,
});

export const title = style({
    fontFamily: vars.font.display,
    fontSize: '0.95rem',
    fontWeight: 700,
    color: vars.color.foreground,
});

export const closeButton = style({
    width: '2rem',
    height: '2rem',
    borderRadius: vars.radius.sm,
    border: `1px solid ${vars.color.border}`,
    color: vars.color.mutedForeground,
    background: vars.color.inset,
    cursor: 'pointer',
});

export const steps = style({
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: vars.space.xs,
    padding: `${vars.space.md} ${vars.space.lg} 0`,
});

const stepBase = style({
    minHeight: '2.25rem',
    borderRadius: vars.radius.sm,
    border: `1px solid ${vars.color.border}`,
    background: vars.color.inset,
    color: vars.color.mutedForeground,
    fontSize: '0.72rem',
    fontWeight: 600,
});

export const step = styleVariants({
    off: [stepBase],
    on: [
        stepBase,
        {
            borderColor: vars.color.accent,
            color: vars.color.accent,
            background: vars.color.accentDim,
        },
    ],
});

export const body = style({
    padding: vars.space.lg,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: vars.space.md,
});

export const brokerGrid = style({
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: vars.space.sm,
});

export const brokerButton = style({
    minHeight: '5rem',
    textAlign: 'left',
    borderRadius: vars.radius.md,
    border: `1px solid ${vars.color.border}`,
    background: vars.color.inset,
    color: vars.color.foreground,
    padding: vars.space.md,
    cursor: 'pointer',
});

export const fieldGrid = style({
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: vars.space.md,
});

export const field = style({
    display: 'flex',
    flexDirection: 'column',
    gap: vars.space.xs,
});

export const label = style({
    fontSize: '0.72rem',
    fontWeight: 700,
    color: vars.color.mutedForeground,
});

export const input = style({
    width: '100%',
    minWidth: 0,
    fontFamily: vars.font.body,
    fontSize: '0.8rem',
    color: vars.color.foreground,
    background: vars.color.inset,
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.sm,
    padding: '7px 9px',
    outline: 'none',
    ':focus': { borderColor: vars.color.accent },
});

export const fileRow = style({
    display: 'flex',
    gap: vars.space.xs,
});

export const secondaryButton = style({
    flexShrink: 0,
    borderRadius: vars.radius.sm,
    border: `1px solid ${vars.color.border}`,
    color: vars.color.foreground,
    background: vars.color.muted,
    padding: '0 10px',
    cursor: 'pointer',
});

export const errorText = style({
    minHeight: '1rem',
    fontSize: '0.68rem',
    color: vars.color.danger,
});

export const hint = style({
    fontSize: '0.72rem',
    color: vars.color.mutedForeground,
    lineHeight: 1.5,
});

export const summary = style({
    border: `1px solid ${vars.color.border}`,
    borderRadius: vars.radius.md,
    background: vars.color.inset,
    padding: vars.space.md,
    display: 'grid',
    gap: vars.space.sm,
});

export const footer = style({
    display: 'flex',
    justifyContent: 'space-between',
    gap: vars.space.md,
    padding: `${vars.space.md} ${vars.space.lg}`,
    borderTop: `1px solid ${vars.color.border}`,
});

export const primaryButton = style({
    borderRadius: vars.radius.sm,
    border: `1px solid ${vars.color.accent}`,
    color: vars.color.accent,
    background: vars.color.accentDim,
    padding: '7px 14px',
    fontWeight: 700,
    cursor: 'pointer',
    ':disabled': {
        opacity: 0.5,
        cursor: 'not-allowed',
    },
});
```

- [ ] **Step 2: Create the wizard component**

Create `src/components/broker-setup-wizard.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { setDefaultTradeBroker, setTradeMetadata, setTradeSource } from '../lib/backend';
import {
    brokerMetadataFromSetupForm,
    type BrokerName,
    type BrokerSetupForm,
} from '../lib/broker-secret-payload';
import { saveBrokerSecrets, deleteBrokerSecrets } from '../lib/broker-secret-store';
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

type Step = 0 | 1 | 2;

export interface BrokerSetupWizardProps {
    open: boolean;
    initialBroker: BrokerName | null;
    configured: Record<BrokerName, boolean>;
    currentBroker: BrokerName | 'mock';
    onClose: () => void;
}

export function BrokerSetupWizard({
    open,
    initialBroker,
    configured,
    currentBroker,
    onClose,
}: BrokerSetupWizardProps) {
    const [step, setStep] = useState<Step>(initialBroker ? 1 : 0);
    const [broker, setBroker] = useState<BrokerName | null>(initialBroker);
    const [form, setForm] = useState<BrokerSetupForm>(emptyBrokerSetupForm);
    const [errors, setErrors] = useState<BrokerSetupErrors>({});
    const [makeDefault, setMakeDefault] = useState(false);
    const [busy, setBusy] = useState(false);
    const [submitError, setSubmitError] = useState('');

    const fields = useMemo(() => (broker ? fieldsForBroker(broker) : []), [broker]);
    const summary = broker ? brokerSetupSummary(broker, form) : null;

    if (!open) return null;

    const update = (key: keyof BrokerSetupForm, value: string) => {
        setForm((current) => ({ ...current, [key]: value }));
        setErrors((current) => ({ ...current, [key]: undefined }));
        setSubmitError('');
    };

    const chooseFile = async () => {
        const path = await chooseCertificateFile();
        if (path) update('certPath', path);
    };

    const validateAndReview = () => {
        if (!broker) return;
        const nextErrors = validateBrokerSetupForm(broker, form);
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length === 0) setStep(2);
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
            const res = await setTradeSource({
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
                await saveBrokerSecrets(broker, form);
                savedSecrets = true;
                await setTradeMetadata(brokerMetadataFromSetupForm(broker, form));
            }
            if (makeDefault) await setDefaultTradeBroker(broker);
            if (res.warning) {
                setSubmitError(`${res.warning}（5 秒後重新整理）`);
                setTimeout(() => window.location.reload(), 5000);
                return;
            }
            window.location.reload();
        } catch (e) {
            if (savedSecrets && broker) {
                await deleteBrokerSecrets(broker).catch(() => null);
            }
            await setTradeSource({ provider: 'mock' }).catch(() => null);
            setSubmitError(e instanceof Error ? e.message : String(e));
            setBusy(false);
        }
    };

    return (
        <div className={styles.overlay} onClick={onClose}>
            <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
                <div className={styles.header}>
                    <div className={styles.title}>券商設定精靈</div>
                    <button className={styles.closeButton} onClick={onClose}>X</button>
                </div>
                <div className={styles.steps}>
                    {['選券商', '填寫登入資訊', '檢查並登入'].map((label, index) => (
                        <button
                            key={label}
                            className={styles.step[step === index ? 'on' : 'off']}
                            disabled={index > step}
                            onClick={() => setStep(index as Step)}
                        >
                            {index + 1}. {label}
                        </button>
                    ))}
                </div>
                <div className={styles.body}>
                    {step === 0 && (
                        <div className={styles.brokerGrid}>
                            {(['fubon', 'nova', 'esun'] as const).map((name) => (
                                <button
                                    key={name}
                                    className={styles.brokerButton}
                                    onClick={() => {
                                        setBroker(name);
                                        setStep(1);
                                    }}
                                >
                                    <strong>{BROKER_LABEL[name]}</strong>
                                    <div className={styles.hint}>
                                        {currentBroker === name
                                            ? '目前登入中'
                                            : configured[name]
                                              ? '已設定，可重新設定'
                                              : '未設定'}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                    {step === 1 && broker && (
                        <>
                            <div className={styles.fieldGrid}>
                                {fields.map((field) => (
                                    <label key={field.key} className={styles.field}>
                                        <span className={styles.label}>{field.label}</span>
                                        {field.key === 'certPath' ? (
                                            <div className={styles.fileRow}>
                                                <input
                                                    className={styles.input}
                                                    value={form.certPath}
                                                    placeholder={field.placeholder}
                                                    onChange={(e) => update('certPath', e.target.value)}
                                                />
                                                <button
                                                    type='button'
                                                    className={styles.secondaryButton}
                                                    onClick={chooseFile}
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
                                                onChange={(e) => update(field.key, e.target.value)}
                                            />
                                        )}
                                        <span className={styles.errorText}>{errors[field.key] ?? ''}</span>
                                    </label>
                                ))}
                            </div>
                            <div className={styles.hint}>
                                登入資訊會存到系統安全儲存；設定檔只保存憑證檔位置等非敏感資料。
                            </div>
                        </>
                    )}
                    {step === 2 && broker && summary && (
                        <>
                            <div className={styles.summary}>
                                <div>券商：{summary.brokerLabel}</div>
                                <div>{summary.accountLabel}：{summary.accountValue}</div>
                                <div>憑證檔：{summary.certificateFileName || summary.certificatePath}</div>
                                <div>安全儲存：登入資訊會存到系統安全儲存</div>
                            </div>
                            <label className={styles.hint}>
                                <input
                                    type='checkbox'
                                    checked={makeDefault}
                                    onChange={(e) => setMakeDefault(e.target.checked)}
                                />{' '}
                                以後開啟 App 時優先登入這家券商
                            </label>
                            {submitError && <div className={styles.errorText}>{submitError}</div>}
                        </>
                    )}
                </div>
                <div className={styles.footer}>
                    <button
                        className={styles.secondaryButton}
                        onClick={() => (step === 0 ? onClose() : setStep((step - 1) as Step))}
                        disabled={busy}
                    >
                        {step === 0 ? '取消' : '上一步'}
                    </button>
                    {step < 2 ? (
                        <button
                            className={styles.primaryButton}
                            disabled={!broker}
                            onClick={() => (step === 0 ? setStep(1) : validateAndReview())}
                        >
                            下一步
                        </button>
                    ) : (
                        <button className={styles.primaryButton} disabled={busy} onClick={submit}>
                            {busy ? '登入中…' : '儲存並登入'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
```

- [ ] **Step 3: Build to catch TypeScript and CSS issues**

Run:

```sh
pnpm build
```

Expected: build passes. If TypeScript flags stale closure or style type issues, fix the smallest local issue in the wizard files and rerun.

- [ ] **Step 4: Commit the wizard component**

Run:

```sh
git add src/components/broker-setup-wizard.tsx src/components/broker-setup-wizard.css.ts
git commit -m "feat: add broker setup wizard modal"
```

## Task 5: Wire The Wizard Into The Broker Menu

**Files:**
- Modify: `src/components/hud-header.tsx`

- [ ] **Step 1: Replace inline credential form with wizard entry state**

In `src/components/hud-header.tsx`, import:

```ts
import { BrokerSetupWizard } from './broker-setup-wizard';
```

In `BrokerMenu`, replace `pending`, `form`, and `field` state with:

```ts
const [wizardBroker, setWizardBroker] = useState<BrokerName | null>(null);
const [wizardOpen, setWizardOpen] = useState(false);
```

Keep `doSwitch`, `doSavedSwitch`, and `pick` for existing configured-login behavior. Remove `switchWithNewCredentials` from `hud-header.tsx`; the wizard now owns new credential setup.

- [ ] **Step 2: Add menu actions for setup wizard**

Inside the broker menu after the broker button group, add:

```tsx
<button
    className={styles.menuItem}
    disabled={Boolean(busy)}
    onClick={() => {
        setWizardBroker(null);
        setWizardOpen(true);
    }}
>
    設定券商登入
</button>
```

For configured brokers, change "用其他帳號登入" buttons to:

```tsx
onClick={() => {
    setWizardBroker(p);
    setWizardOpen(true);
    setError('');
}}
```

Remove the inline `{pending && (...)}` credential form block.

- [ ] **Step 3: Render the wizard beside the menu**

Wrap the existing `<Menu label={`券商·${BROKER_LABEL[current]}`}>...</Menu>` return value in a fragment and render this wizard immediately after the `</Menu>` closing tag:

```tsx
<BrokerSetupWizard
    open={wizardOpen}
    initialBroker={wizardBroker}
    currentBroker={current}
    configured={{
        fubon: Boolean(config?.creds?.fubon?.saved || config?.creds?.fubon?.env),
        nova: Boolean(config?.creds?.nova?.saved || config?.creds?.nova?.env),
        esun: Boolean(config?.creds?.esun?.saved || config?.creds?.esun?.env),
    }}
    onClose={() => setWizardOpen(false)}
/>
```

- [ ] **Step 4: Verify the header build**

Run:

```sh
pnpm build
```

Expected: build passes and no unused imports remain.

- [ ] **Step 5: Commit menu wiring**

Run:

```sh
git add src/components/hud-header.tsx
git commit -m "feat: open broker setup wizard from menu"
```

## Task 6: Full Verification And Desktop Build

**Files:**
- Modify: none unless verification exposes a bug.

- [ ] **Step 1: Run full automated checks**

Run:

```sh
pnpm test
pnpm build
pnpm --filter kau-ik-pro-server run typecheck
cargo test --manifest-path src-tauri/Cargo.toml broker_secret
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all commands pass. The Vite chunk-size warning is acceptable if no errors occur.

- [ ] **Step 2: Run desktop doctor**

Run:

```sh
pnpm desktop:doctor
```

Expected: toolchain OK and ready to build.

- [ ] **Step 3: Build the packaged desktop app**

Run:

```sh
pnpm desktop:build
```

Expected: bundles are produced under:

```text
src-tauri/target/release/bundle/
```

- [ ] **Step 4: Smoke-check secure storage CLI**

Run:

```sh
src-tauri/target/release/kau-ik-pro-app --secure-storage-spike write
src-tauri/target/release/kau-ik-pro-app --secure-storage-spike read
src-tauri/target/release/kau-ik-pro-app --secure-storage-spike delete
```

Expected: write returns `"ok":true`, read returns `"valueMatches":true`, delete returns `"present":false`.

- [ ] **Step 5: Commit verification fixes only if needed**

If verification required code fixes, inspect the changed files first:

```sh
git status --short
```

Stage only the files changed by those verification fixes. For example, if the fixes touched the wizard component and CSS:

```sh
git add src/components/broker-setup-wizard.tsx src/components/broker-setup-wizard.css.ts
git commit -m "fix: stabilize broker setup wizard"
```

If no fixes were needed, do not create an empty commit.

- [ ] **Step 6: Push branch**

Run:

```sh
git push -u fork codex/broker-setup-wizard-pr2
```

Expected: branch is pushed to `fork/codex/broker-setup-wizard-pr2`.
