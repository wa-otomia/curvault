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

pub fn run() {
    fixup_path();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            services::install_app_handle(app.handle().clone());
            Ok(())
        })
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
            commands::pkcs15_create,
            commands::fido2_list_devices,
            commands::fido2_info,
            commands::fido2_list_credentials,
            commands::fido2_delete_credential,
            commands::fido2_set_pin,
            commands::fido2_reset,
            commands::run_issuance,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
