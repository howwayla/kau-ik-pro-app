# Broker Setup Wizard Design

## Goal

Build a broker setup wizard that helps non-technical users configure Fubon, Taishin, and Esun broker login safely from the desktop app. The wizard should replace the current dense broker credential form inside the header popover with a guided modal flow.

## Scope

PR2 focuses on the setup experience only:

- Open a modal wizard from the existing broker menu.
- Guide users through broker selection, credential entry, certificate file selection, and final save-and-login confirmation.
- Add a certificate file picker so users do not need to type an absolute path.
- Offer an optional checkbox: "以後開啟 App 時優先登入這家券商".
- Keep the PR1 secure-storage behavior: secrets go to OS secure storage; config only stores non-secret metadata.

PR2 does not build a full settings center, account management page, or automatic login implementation beyond persisting the user's preference in a shape that a later PR can consume.

## User Experience

### Entry Point

The header broker menu remains compact. It should show the current broker state and provide clear actions:

- Click a configured broker to log in.
- Click "設定券商登入" to open the setup wizard.
- Click "用其他帳號登入" for a configured broker to open the wizard preselected to that broker.

The broker menu should no longer expose a long credential form inline.

### Modal Flow

The modal uses three steps:

1. 選券商
2. 填寫登入資訊
3. 檢查並登入

The modal should feel like a focused operational tool, not a marketing page. It should use the app's existing compact visual language: restrained panels, clear labels, stable button sizes, and no decorative hero treatment.

### Step 1: 選券商

Show Fubon, Taishin, and Esun as selectable rows or tiles. Each option shows:

- Broker name in Chinese.
- Current state: 未設定, 已設定, or 目前登入中.
- A short preparation hint, such as whether this broker requires API Key or API Secret.

Selecting a broker moves to step 2. If a broker is already configured, the user can still continue to replace its saved login information.

### Step 2: 填寫登入資訊

Show only the fields required for the selected broker.

Common fields:

- 身分證字號 or 證券帳號, depending on broker.
- 登入密碼.
- 憑證檔位置.
- 憑證密碼.

Broker-specific fields:

- Fubon: API Key is optional and may be used instead of password where supported by the existing provider behavior.
- Taishin: API URL may be hidden under an advanced section only if the existing metadata supports it.
- Esun: API Key and API Secret are required.

The certificate path field includes:

- A readonly-looking text input showing the selected path.
- A "選擇檔案" button that opens a native file dialog.
- Manual paste remains possible as a fallback.
- The file dialog should filter for `.p12` and `.pfx` when the platform supports filters.

The copy should be plain-language and reassuring:

- "登入資訊會存到系統安全儲存。"
- "設定檔只保存憑證檔位置等非敏感資料。"

### Step 3: 檢查並登入

Show a summary without revealing secret values:

- Selected broker.
- Certificate filename or path.
- Whether required fields are filled.
- Whether system secure storage is available if the app can check it before submit.

Include the checkbox:

```text
□ 以後開啟 App 時優先登入這家券商
```

The checkbox is off by default. Turning it on should save the chosen broker as a default-login preference, but PR2 does not need to perform automatic login on app startup.

Primary action:

```text
儲存並登入
```

On success, close the modal, reload or refresh as the current provider-switch flow requires, and show the broker as configured next time the broker menu opens.

## Error Handling

Validation errors should appear next to the relevant field where possible:

- Missing account ID.
- Missing password or required API key.
- Missing certificate path.
- Missing certificate password.
- Missing Esun API Secret.

Submit errors should appear in the final step and keep the modal open:

- Broker login failed.
- Certificate file path is invalid or unreadable, if the current provider can surface that.
- OS secure storage failed.
- Local server failed to switch provider.

If secure storage fails after broker login validation, keep PR1 behavior: clean up partial storage when possible, switch back to mock, and tell the user that the setup was not saved.

No real credential values should be printed to logs, test output, or visible error messages.

## Data Flow

The wizard reuses the PR1 data path:

1. User enters credentials in React state.
2. For desktop/Tauri, the app calls the broker login endpoint with `persist_metadata: false`.
3. After successful login, the app saves secret fields to OS secure storage through Tauri.
4. The app saves broker metadata through the existing metadata endpoint.
5. If the default-login checkbox is checked, the app persists the chosen broker in non-secret runtime config.

The wizard must not persist `idNo`, `password`, `apiKey`, `apiSecret`, or `certPass` to `server/data/config.json`.

## Components And Boundaries

Create a dedicated broker setup wizard component rather than growing `hud-header.tsx` further.

Recommended boundaries:

- `BrokerMenu`: compact status and entry actions.
- `BrokerSetupWizard`: modal shell, step state, submit orchestration.
- `broker-setup-fields`: broker-specific field definitions, labels, required fields, and validation helpers.
- `broker-certificate-file`: native file picker wrapper for certificate file selection.

The wizard should accept dependencies as props or small helper functions where that makes tests straightforward.

## Testing

Add tests around pure helpers first:

- Broker-specific required fields.
- Validation messages.
- Metadata and secret payload separation.
- Default-login preference payload.
- Certificate file picker result normalization, if implemented as a helper.

Add component-level or lightweight integration tests only if the repo already has a suitable React test setup. If not, keep PR2 test coverage focused on pure state and data-flow helpers, and verify the UI with `pnpm build` plus manual desktop smoke testing.

Verification for PR2:

- `pnpm test`
- `pnpm build`
- `pnpm --filter kau-ik-pro-server run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml broker_secret`
- `pnpm desktop:build`

## Acceptance Criteria

- A non-technical user can open a modal and complete broker setup without editing files or manually typing a certificate absolute path.
- Fubon, Taishin, and Esun each show only the fields they need.
- The wizard can replace saved credentials for an already configured broker.
- The final step clearly states where secrets are stored.
- The default-login checkbox is present and off by default.
- Config persistence remains metadata-only for broker credentials.
- Existing mock mode remains the safe default.
