mod commands;
mod services;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::list_readers,
            commands::inspect_card,
            commands::list_gp_keys,
            commands::generate_gp_key,
            commands::delete_gp_key,
            commands::lock_gp_key,
            commands::install_applet,
            commands::uninstall_applet,
            commands::list_profiles,
            commands::save_profile,
            commands::delete_profile,
            commands::run_issuance,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
