use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent,
};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

// Holds the spawned Node server sidecar so it can be killed on app exit.
struct NovaServer(Mutex<Option<CommandChild>>);

const SECURE_STORAGE_SPIKE_SERVICE: &str = "io.github.howwayla.kauikpro.secure-storage-spike";
const SECURE_STORAGE_SPIKE_ACCOUNT: &str = "roundtrip-test";
const SECURE_STORAGE_SPIKE_VALUE: &str = "kau-ik-pro-spike-value-v1";
const BROKER_SECRET_SERVICE: &str = "io.github.howwayla.kauikpro.broker-secrets";
const DESKTOP_AUTH_HEADER: &str = "x-kauik-desktop-auth";
const BROKER_SECRET_HTTP_TIMEOUT_SECS: u64 = 15;
static DESKTOP_AUTH_TOKEN: OnceLock<String> = OnceLock::new();

type HmacSha256 = Hmac<Sha256>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecureStorageSpikeResult {
    ok: bool,
    present: bool,
    value_matches: Option<bool>,
    error: Option<String>,
}

impl SecureStorageSpikeResult {
    fn ok(present: bool, value_matches: Option<bool>) -> Self {
        Self {
            ok: true,
            present,
            value_matches,
            error: None,
        }
    }

    fn error(err: keyring::Error) -> Self {
        Self {
            ok: false,
            present: false,
            value_matches: None,
            error: Some(err.to_string()),
        }
    }
}

fn secure_storage_spike_entry() -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new(SECURE_STORAGE_SPIKE_SERVICE, SECURE_STORAGE_SPIKE_ACCOUNT)
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerSecrets {
    id_no: String,
    password: String,
    api_key: String,
    api_secret: String,
    cert_pass: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerSecretMetadata {
    cert_path: String,
    api_url: String,
}

#[derive(Serialize)]
struct BrokerSecretLoginRequest<'a> {
    provider: &'a str,
    id_no: &'a str,
    password: &'a str,
    api_key: &'a str,
    api_secret: &'a str,
    cert_path: &'a str,
    cert_pass: &'a str,
    api_url: &'a str,
    persist_metadata: bool,
}

#[derive(Deserialize)]
struct BrokerSecretLoginServerOk {
    provider: String,
    market: String,
    warning: Option<String>,
}

#[derive(Deserialize)]
struct BrokerSecretLoginServerError {
    detail: Option<String>,
    message: Option<String>,
}

#[derive(Deserialize)]
struct DesktopIdentityResponse {
    signature: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerSecretLoginResult {
    ok: bool,
    provider: Option<String>,
    market: Option<String>,
    warning: Option<String>,
    error: Option<String>,
}

impl BrokerSecretLoginResult {
    fn ok(result: BrokerSecretLoginServerOk) -> Self {
        Self {
            ok: true,
            provider: Some(result.provider),
            market: Some(result.market),
            warning: result.warning,
            error: None,
        }
    }

    fn error(error: impl Into<String>) -> Self {
        Self {
            ok: false,
            provider: None,
            market: None,
            warning: None,
            error: Some(error.into()),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrokerSecretCommandResult {
    ok: bool,
    present: bool,
    error: Option<String>,
}

impl BrokerSecretCommandResult {
    fn ok(present: bool) -> Self {
        Self {
            ok: true,
            present,
            error: None,
        }
    }

    fn error(error: impl Into<String>) -> Self {
        Self {
            ok: false,
            present: false,
            error: Some(error.into()),
        }
    }
}

fn broker_secret_account(broker: &str) -> Result<&'static str, String> {
    match broker {
        "fubon" => Ok("fubon:v1"),
        "nova" => Ok("nova:v1"),
        "esun" => Ok("esun:v1"),
        _ => Err("unsupported broker".to_string()),
    }
}

fn broker_secret_entry(broker: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(BROKER_SECRET_SERVICE, broker_secret_account(broker)?)
        .map_err(|err| err.to_string())
}

fn desktop_identity_signature(token: &str, nonce: &str) -> Result<String, String> {
    let mut mac = HmacSha256::new_from_slice(token.as_bytes()).map_err(|err| err.to_string())?;
    mac.update(nonce.as_bytes());
    Ok(hex::encode(mac.finalize().into_bytes()))
}

fn generate_desktop_auth_token() -> String {
    let mut bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

fn set_desktop_auth_token(token: String) {
    let _ = DESKTOP_AUTH_TOKEN.set(token);
}

fn desktop_auth_token() -> Result<&'static str, String> {
    DESKTOP_AUTH_TOKEN
        .get()
        .map(String::as_str)
        .ok_or_else(|| "desktop auth token not initialized".to_string())
}

fn broker_secret_http_client() -> Result<reqwest::Client, reqwest::Error> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(BROKER_SECRET_HTTP_TIMEOUT_SECS))
        .build()
}

async fn verify_desktop_server_identity(
    client: &reqwest::Client,
    token: &str,
) -> Result<(), String> {
    let nonce = generate_desktop_auth_token();
    let response = client
        .get(format!(
            "http://127.0.0.1:8080/api/v1/desktop/identity?nonce={nonce}",
        ))
        .send()
        .await
        .map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err("本機服務身分驗證失敗".to_string());
    }
    let body = response
        .json::<DesktopIdentityResponse>()
        .await
        .map_err(|err| err.to_string())?;
    let expected = desktop_identity_signature(token, &nonce)?;
    if body.signature != expected {
        return Err("本機服務身分驗證不符".to_string());
    }
    Ok(())
}

fn broker_secrets_to_json(secrets: &BrokerSecrets) -> Result<String, serde_json::Error> {
    serde_json::to_string(secrets)
}

fn broker_secrets_from_json(json: &str) -> Result<BrokerSecrets, serde_json::Error> {
    serde_json::from_str(json)
}

fn broker_secret_login_request<'a>(
    broker: &'a str,
    metadata: &'a BrokerSecretMetadata,
    secrets: &'a BrokerSecrets,
) -> BrokerSecretLoginRequest<'a> {
    BrokerSecretLoginRequest {
        provider: broker,
        id_no: &secrets.id_no,
        password: &secrets.password,
        api_key: &secrets.api_key,
        api_secret: &secrets.api_secret,
        cert_path: &metadata.cert_path,
        cert_pass: &secrets.cert_pass,
        api_url: &metadata.api_url,
        persist_metadata: false,
    }
}

pub fn broker_secret_save_result(
    broker: &str,
    secrets: BrokerSecrets,
) -> BrokerSecretCommandResult {
    let entry = match broker_secret_entry(broker) {
        Ok(entry) => entry,
        Err(err) => return BrokerSecretCommandResult::error(err),
    };
    let json = match broker_secrets_to_json(&secrets) {
        Ok(json) => json,
        Err(err) => return BrokerSecretCommandResult::error(err.to_string()),
    };
    match entry.set_password(&json) {
        Ok(()) => BrokerSecretCommandResult::ok(true),
        Err(err) => BrokerSecretCommandResult::error(err.to_string()),
    }
}

pub fn broker_secret_status_result(broker: &str) -> BrokerSecretCommandResult {
    let entry = match broker_secret_entry(broker) {
        Ok(entry) => entry,
        Err(err) => return BrokerSecretCommandResult::error(err),
    };
    match entry.get_password() {
        Ok(_) => BrokerSecretCommandResult::ok(true),
        Err(keyring::Error::NoEntry) => BrokerSecretCommandResult::ok(false),
        Err(err) => BrokerSecretCommandResult::error(err.to_string()),
    }
}

pub fn broker_secret_load_result(broker: &str) -> Result<Option<BrokerSecrets>, String> {
    let entry = broker_secret_entry(broker)?;
    match entry.get_password() {
        Ok(json) => broker_secrets_from_json(&json)
            .map(Some)
            .map_err(|err| err.to_string()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

pub fn broker_secret_delete_result(broker: &str) -> BrokerSecretCommandResult {
    let entry = match broker_secret_entry(broker) {
        Ok(entry) => entry,
        Err(err) => return BrokerSecretCommandResult::error(err),
    };
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => BrokerSecretCommandResult::ok(false),
        Err(err) => BrokerSecretCommandResult::error(err.to_string()),
    }
}

pub async fn broker_secret_login_result(
    broker: String,
    metadata: BrokerSecretMetadata,
) -> BrokerSecretLoginResult {
    if let Err(err) = broker_secret_account(&broker) {
        return BrokerSecretLoginResult::error(err);
    }
    if metadata.cert_path.trim().is_empty() {
        return BrokerSecretLoginResult::error("缺少憑證路徑");
    }
    let secrets = match broker_secret_load_result(&broker) {
        Ok(Some(secrets)) => secrets,
        Ok(None) => {
            return BrokerSecretLoginResult::error("尚未在系統安全儲存中找到這家券商的登入資訊");
        }
        Err(err) => return BrokerSecretLoginResult::error(err),
    };
    let request = broker_secret_login_request(&broker, &metadata, &secrets);
    let token = match desktop_auth_token() {
        Ok(token) => token,
        Err(err) => return BrokerSecretLoginResult::error(err),
    };
    let client = match broker_secret_http_client() {
        Ok(client) => client,
        Err(err) => return BrokerSecretLoginResult::error(err.to_string()),
    };
    if let Err(err) = verify_desktop_server_identity(&client, token).await {
        return BrokerSecretLoginResult::error(err);
    }
    let response = match client
        .post("http://127.0.0.1:8080/api/v1/config/trade")
        .header(DESKTOP_AUTH_HEADER, token)
        .json(&request)
        .send()
        .await
    {
        Ok(response) => response,
        Err(err) => return BrokerSecretLoginResult::error(err.to_string()),
    };
    let status = response.status();
    let text = match response.text().await {
        Ok(text) => text,
        Err(err) => return BrokerSecretLoginResult::error(err.to_string()),
    };
    if !status.is_success() {
        let detail = serde_json::from_str::<BrokerSecretLoginServerError>(&text)
            .ok()
            .and_then(|body| body.detail.or(body.message))
            .filter(|message| !message.trim().is_empty())
            .unwrap_or_else(|| format!("本機服務回應 {status}"));
        return BrokerSecretLoginResult::error(detail);
    }
    match serde_json::from_str::<BrokerSecretLoginServerOk>(&text) {
        Ok(result) => BrokerSecretLoginResult::ok(result),
        Err(err) => BrokerSecretLoginResult::error(err.to_string()),
    }
}

pub fn secure_storage_spike_write_result() -> SecureStorageSpikeResult {
    let entry = match secure_storage_spike_entry() {
        Ok(entry) => entry,
        Err(err) => return SecureStorageSpikeResult::error(err),
    };
    match entry.set_password(SECURE_STORAGE_SPIKE_VALUE) {
        Ok(()) => SecureStorageSpikeResult::ok(true, None),
        Err(err) => SecureStorageSpikeResult::error(err),
    }
}

pub fn secure_storage_spike_read_result() -> SecureStorageSpikeResult {
    let entry = match secure_storage_spike_entry() {
        Ok(entry) => entry,
        Err(err) => return SecureStorageSpikeResult::error(err),
    };
    match entry.get_password() {
        Ok(value) => SecureStorageSpikeResult::ok(true, Some(value == SECURE_STORAGE_SPIKE_VALUE)),
        Err(keyring::Error::NoEntry) => SecureStorageSpikeResult::ok(false, Some(false)),
        Err(err) => SecureStorageSpikeResult::error(err),
    }
}

pub fn secure_storage_spike_delete_result() -> SecureStorageSpikeResult {
    let entry = match secure_storage_spike_entry() {
        Ok(entry) => entry,
        Err(err) => return SecureStorageSpikeResult::error(err),
    };
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => SecureStorageSpikeResult::ok(false, None),
        Err(err) => SecureStorageSpikeResult::error(err),
    }
}

pub fn run_secure_storage_spike_cli(action: &str) -> i32 {
    let result = match action {
        "write" => secure_storage_spike_write_result(),
        "read" => secure_storage_spike_read_result(),
        "delete" => secure_storage_spike_delete_result(),
        _ => SecureStorageSpikeResult {
            ok: false,
            present: false,
            value_matches: None,
            error: Some("unsupported secure storage spike action".to_string()),
        },
    };

    match serde_json::to_string(&result) {
        Ok(json) => println!("{json}"),
        Err(err) => eprintln!("failed to serialize secure storage spike result: {err}"),
    }

    if result.ok {
        0
    } else {
        1
    }
}

#[tauri::command]
fn secure_storage_spike_write() -> SecureStorageSpikeResult {
    secure_storage_spike_write_result()
}

#[tauri::command]
fn secure_storage_spike_read() -> SecureStorageSpikeResult {
    secure_storage_spike_read_result()
}

#[tauri::command]
fn secure_storage_spike_delete() -> SecureStorageSpikeResult {
    secure_storage_spike_delete_result()
}

#[tauri::command]
fn broker_secret_save(broker: String, secrets: BrokerSecrets) -> BrokerSecretCommandResult {
    broker_secret_save_result(&broker, secrets)
}

#[tauri::command]
fn broker_secret_status(broker: String) -> BrokerSecretCommandResult {
    broker_secret_status_result(&broker)
}

#[tauri::command]
fn broker_secret_delete(broker: String) -> BrokerSecretCommandResult {
    broker_secret_delete_result(&broker)
}

#[tauri::command]
async fn broker_secret_login(
    broker: String,
    metadata: BrokerSecretMetadata,
) -> BrokerSecretLoginResult {
    broker_secret_login_result(broker, metadata).await
}

fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

// Spawn the bundled `nova-server` sidecar (the compiled Node/Fastify server)
// on 127.0.0.1:8080 — the port the frontend targets in desktop mode
// (see src/lib/runtime.ts getApiBase()).
fn spawn_nova_server(app: &AppHandle, data_dir: PathBuf, desktop_auth_token: &str) {
    let command = match app.shell().sidecar("nova-server") {
        Ok(cmd) => cmd
            .env("HOST", "127.0.0.1")
            .env("PORT", "8080")
            .env("KAUIK_DATA_DIR", data_dir.to_string_lossy().to_string())
            .env("KAUIK_DESKTOP_AUTH_TOKEN", desktop_auth_token),
        Err(err) => {
            log::error!("failed to create nova-server sidecar: {err}");
            return;
        }
    };

    match command.spawn() {
        Ok((mut rx, child)) => {
            app.manage(NovaServer(Mutex::new(Some(child))));
            log::info!("nova-server sidecar spawned on 127.0.0.1:8080");
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            log::info!("[nova-server] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            log::info!("[nova-server] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Error(err) => {
                            log::error!("[nova-server] {err}");
                        }
                        CommandEvent::Terminated(payload) => {
                            log::warn!("[nova-server] terminated: {:?}", payload);
                        }
                        _ => {}
                    }
                }
            });
        }
        Err(err) => log::error!("failed to spawn nova-server sidecar: {err}"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // focus the existing window when a second instance launches
            show_main(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            secure_storage_spike_write,
            secure_storage_spike_read,
            secure_storage_spike_delete,
            broker_secret_save,
            broker_secret_status,
            broker_secret_delete,
            broker_secret_login
        ])
        .setup(|app| {
            // ---- bundled Node server sidecar (auto-started; killed on exit) ----
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let desktop_auth_token = generate_desktop_auth_token();
            set_desktop_auth_token(desktop_auth_token.clone());
            spawn_nova_server(app.handle(), data_dir, &desktop_auth_token);

            // ---- tray / menu-bar icon ----
            let show = MenuItem::with_id(app, "show", "顯示 Kau-ik Pro", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "結束", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let mut tray = TrayIconBuilder::with_id("main-tray")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Kau-ik Pro")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
                #[cfg(target_os = "macos")]
                {
                    tray = tray.icon_as_template(false);
                }
            }
            tray.build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // closing the main window hides to tray (menu-bar app behaviour)
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // kill the sidecar when the app fully exits
            if let RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<NovaServer>() {
                    if let Some(child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secure_storage_spike_uses_fixed_non_broker_identifiers() {
        assert_eq!(
            SECURE_STORAGE_SPIKE_SERVICE,
            "io.github.howwayla.kauikpro.secure-storage-spike"
        );
        assert_eq!(SECURE_STORAGE_SPIKE_ACCOUNT, "roundtrip-test");
        assert_eq!(SECURE_STORAGE_SPIKE_VALUE, "kau-ik-pro-spike-value-v1");
    }

    #[test]
    fn broker_secret_accounts_are_fixed_for_supported_brokers() {
        assert_eq!(broker_secret_account("fubon").unwrap(), "fubon:v1");
        assert_eq!(broker_secret_account("nova").unwrap(), "nova:v1");
        assert_eq!(broker_secret_account("esun").unwrap(), "esun:v1");
        assert!(broker_secret_account("sinopac").is_err());
    }

    #[test]
    fn broker_secret_payload_roundtrips_without_metadata_fields() {
        let secrets = BrokerSecrets {
            id_no: "A123456789".to_string(),
            password: "account-pass".to_string(),
            api_key: "api-key".to_string(),
            api_secret: "api-secret".to_string(),
            cert_pass: "cert-pass".to_string(),
        };

        let json = broker_secrets_to_json(&secrets).unwrap();

        assert!(json.contains("\"idNo\""));
        assert!(json.contains("\"certPass\""));
        assert!(!json.contains("certPath"));
        assert!(!json.contains("apiUrl"));
        assert_eq!(broker_secrets_from_json(&json).unwrap(), secrets);
    }

    #[test]
    fn broker_secret_login_request_uses_metadata_and_saved_secrets() {
        let secrets = BrokerSecrets {
            id_no: "A123456789".to_string(),
            password: "account-pass".to_string(),
            api_key: "api-key".to_string(),
            api_secret: "api-secret".to_string(),
            cert_pass: "cert-pass".to_string(),
        };
        let metadata = BrokerSecretMetadata {
            cert_path: "/private/certs/nova.p12".to_string(),
            api_url: "https://broker.example.test".to_string(),
        };

        let request = broker_secret_login_request("nova", &metadata, &secrets);
        let json = serde_json::to_string(&request).unwrap();

        assert!(json.contains("\"provider\":\"nova\""));
        assert!(json.contains("\"id_no\":\"A123456789\""));
        assert!(json.contains("\"cert_path\":\"/private/certs/nova.p12\""));
        assert!(json.contains("\"persist_metadata\":false"));
        assert!(!json.contains("certPath"));
        assert!(!json.contains("certPass"));
    }

    #[test]
    fn desktop_identity_signature_uses_token_and_nonce() {
        let first = desktop_identity_signature("token-a", "nonce").unwrap();
        let second = desktop_identity_signature("token-b", "nonce").unwrap();

        assert_ne!(first, second);
        assert_eq!(first.len(), 64);
    }

    #[test]
    fn broker_secret_http_client_has_timeout() {
        assert!(broker_secret_http_client().is_ok());
        assert_eq!(BROKER_SECRET_HTTP_TIMEOUT_SECS, 15);
    }
}
