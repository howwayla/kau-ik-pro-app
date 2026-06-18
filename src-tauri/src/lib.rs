use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
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

fn broker_secrets_to_json(secrets: &BrokerSecrets) -> Result<String, serde_json::Error> {
    serde_json::to_string(secrets)
}

fn broker_secrets_from_json(json: &str) -> Result<BrokerSecrets, serde_json::Error> {
    serde_json::from_str(json)
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
fn spawn_nova_server(app: &AppHandle, data_dir: PathBuf) {
    let command = match app.shell().sidecar("nova-server") {
        Ok(cmd) => cmd
            .env("HOST", "127.0.0.1")
            .env("PORT", "8080")
            .env("KAUIK_DATA_DIR", data_dir.to_string_lossy().to_string()),
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
            broker_secret_delete
        ])
        .setup(|app| {
            // ---- bundled Node server sidecar (auto-started; killed on exit) ----
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            spawn_nova_server(app.handle(), data_dir);

            // ---- tray / menu-bar icon ----
            let show =
                MenuItem::with_id(app, "show", "顯示 Kau-ik Pro", true, None::<&str>)?;
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
}
