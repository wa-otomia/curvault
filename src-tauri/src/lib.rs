mod commands;
mod services;

/// Resolve a usable PATH for child processes on app start.
///
/// When the app is launched from Finder, Spotlight, or any other GUI
/// launcher, macOS gives it launchd's minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`)
/// — Homebrew's `/opt/homebrew/bin` is not in there. Same story for many
/// Linux desktop launchers. We don't want users to have to launch the app
/// from a terminal to make `gp`, `opensc-tool`, `pkcs15-init`, etc.
/// resolvable.
///
/// Strategy: ask the user's actual login shell (`$SHELL`, defaulting to
/// `/bin/zsh` on macOS) to source its login + rc files and print its PATH.
/// This picks up Homebrew, MacPorts, asdf, mise, pyenv, nvm, custom
/// per-user installs — anything the user has set up in `.zshrc`,
/// `.zprofile`, `.bash_profile`, etc. We then overwrite our process PATH
/// once; every subsequent `Command::new()` inherits it.
///
/// If the shell call fails or returns nothing useful, fall back to
/// prepending the usual `/opt/homebrew/bin` style paths.
#[cfg(unix)]
fn fixup_path() {
    use std::process::Command;
    use std::path::PathBuf;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let shell_name = std::path::Path::new(&shell)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("zsh");

    // Build a script that force-sources every rc file the shell would look
    // at if invoked interactively in a terminal, then prints the resolved
    // PATH. We do NOT rely on the `-i` flag: many setups guard their PATH
    // mutations behind `[[ -o interactive ]]` or `[[ -t 0 ]]`, which are
    // false when a GUI app spawns the shell with no PTY.
    let script = match shell_name {
        "zsh" => r#"
            emulate zsh
            [ -f /etc/zshenv ]     && . /etc/zshenv
            [ -f "$HOME/.zshenv" ] && . "$HOME/.zshenv"
            [ -f /etc/zprofile ]   && . /etc/zprofile
            [ -f "$HOME/.zprofile" ] && . "$HOME/.zprofile"
            [ -f /etc/zshrc ]      && . /etc/zshrc
            [ -f "$HOME/.zshrc" ]  && . "$HOME/.zshrc" 2>/dev/null
            printf %s "$PATH"
        "#,
        "bash" => r#"
            [ -f /etc/profile ]         && . /etc/profile
            [ -f "$HOME/.bash_profile" ] && . "$HOME/.bash_profile"
            [ -f "$HOME/.bashrc" ]      && . "$HOME/.bashrc" 2>/dev/null
            [ -f "$HOME/.profile" ]     && . "$HOME/.profile"
            printf %s "$PATH"
        "#,
        "fish" => r#"
            for f in /etc/fish/config.fish ~/.config/fish/config.fish
                test -f $f; and source $f 2>/dev/null
            end
            printf %s "$PATH"
        "#,
        // Unknown shell: try a generic POSIX path through it. Most shells
        // accept `-c`; failing that, the fallback below catches it.
        _ => r#"
            [ -f /etc/profile ]      && . /etc/profile
            [ -f "$HOME/.profile" ]  && . "$HOME/.profile"
            printf %s "$PATH"
        "#,
    };

    // Run the shell in NON-interactive mode (no -i) but force-source the
    // files ourselves above. This sidesteps all the `[[ -o interactive ]]`
    // guards while still picking up Homebrew, asdf, mise, pyenv, nvm, etc.
    let output = Command::new(&shell)
        .arg("-c")
        .arg(script)
        .output();

    if let Ok(out) = output {
        if out.status.success() {
            if let Ok(path) = String::from_utf8(out.stdout) {
                let path = path.trim();
                if !path.is_empty() && path.contains('/') {
                    std::env::set_var("PATH", path);
                    return;
                }
            }
        }
    }

    // Shell didn't cooperate (no $SHELL, exotic shell that doesn't accept
    // -lic, sandbox blocks exec, etc.). Prepend the usual Homebrew /
    // MacPorts directories as a best effort.
    let extras = [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/opt/local/bin",
        "/opt/local/sbin",
    ];
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    for d in extras.iter().rev() {
        let pb = PathBuf::from(d);
        if pb.is_dir() && !paths.iter().any(|p| p == &pb) {
            paths.insert(0, pb);
        }
    }
    if let Ok(joined) = std::env::join_paths(paths) {
        std::env::set_var("PATH", joined);
    }
}

#[cfg(not(unix))]
fn fixup_path() {
    // Windows GUI apps inherit a usable PATH from the registry; no shell
    // wrapping required. If a user truly puts custom tooling somewhere
    // exotic, they can add it to the system PATH or restart explorer.exe.
}

/// Open (or focus) a frameless, rounded popup window. The webview branches on
/// its window label (see main.tsx) to render the matching UI from the same
/// bundle.
pub(crate) fn open_popup<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    label: &str,
    title: &str,
    width: f64,
    height: f64,
) {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let _ = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title(title)
        .inner_size(width, height)
        .resizable(false)
        .decorations(false) // frameless — the webview paints a rounded panel
        .transparent(true)  // so the rounded corners cut cleanly
        .shadow(true)
        .center()
        .build();
}

/// The standalone software-update window (download/restart flow).
pub(crate) fn open_updater<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    open_popup(app, "updater", "Software Update", 460.0, 560.0);
}

/// The standalone About window.
pub(crate) fn open_about<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    open_popup(app, "about", "About Curvault", 440.0, 560.0);
}

/// Build the application menu: a custom About + Check-for-Updates pair plus
/// the usual edit/window items. Cross-platform items are unconditional;
/// macOS-only predefined items are gated.
fn build_menu<R: tauri::Runtime>(
    handle: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

    let about = MenuItemBuilder::with_id("about", "About Curvault").build(handle)?;
    let check = MenuItemBuilder::with_id("check-update", "Check for Updates…").build(handle)?;

    #[allow(unused_mut)]
    let mut app_sub = SubmenuBuilder::new(handle, "Curvault")
        .item(&about)
        .item(&check)
        .separator();
    #[cfg(target_os = "macos")]
    {
        app_sub = app_sub
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator();
    }
    let app_sub = app_sub.quit().build()?;

    #[allow(unused_mut)]
    let mut edit = SubmenuBuilder::new(handle, "Edit");
    #[cfg(target_os = "macos")]
    {
        edit = edit.undo().redo().separator();
    }
    let edit = edit.cut().copy().paste().select_all().build()?;

    let window = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .separator()
        .close_window()
        .build()?;

    MenuBuilder::new(handle)
        .items(&[&app_sub, &edit, &window])
        .build()
}

pub fn run() {
    fixup_path();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .menu(|handle| build_menu(handle))
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                // Open the standalone About window rather than the bare native
                // panel.
                "about" => open_about(app),
                "check-update" => open_updater(app),
                _ => {}
            }
        })
        .setup(|app| {
            services::install_app_handle(app.handle().clone());
            // Event-driven reader/card monitoring (falls back to polling if
            // PC/SC is unavailable).
            services::cardmon::start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_readers,
            commands::list_readers_quiet,
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
            commands::pkcs15_create,
            commands::pkcs15_dump,
            commands::pkcs11_dump,
            commands::fido2_list_devices,
            commands::fido2_info,
            commands::fido2_list_credentials,
            commands::fido2_delete_credential,
            commands::fido2_set_pin,
            commands::fido2_reset,
            commands::run_issuance,
            commands::check_for_updates,
            commands::open_updater_window,
            commands::open_about_window,
            commands::pcsc_event_driven,
            commands::pcsc_readers,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
