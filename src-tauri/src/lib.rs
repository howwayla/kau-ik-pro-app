use serde::Serialize;
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
            secure_storage_spike_delete
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
}
