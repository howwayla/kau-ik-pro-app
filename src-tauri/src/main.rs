// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
  if let Some(action) = std::env::args().nth(2) {
    if std::env::args().nth(1).as_deref() == Some("--secure-storage-spike") {
      std::process::exit(app_lib::run_secure_storage_spike_cli(&action));
    }
  }
  app_lib::run();
}
