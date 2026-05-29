pub mod gp;
pub mod opensc;
pub mod pcsc;
pub mod vault;
pub mod profile;
pub mod issuance;
pub mod pkcs15;
pub mod fido2;
pub mod updates;

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ServiceError {
    #[error("command '{0}' failed (exit {1}): {2}")]
    Command(String, i32, String),

    #[error("command '{0}' not found in PATH — install it and try again")]
    NotFound(String),

    #[error("parse error: {0}")]
    Parse(String),

    #[error("keychain error: {0}")]
    Keychain(#[from] keyring::Error),

    #[error("store error: {0}")]
    Store(String),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, ServiceError>;

/// Convert errors into a string-friendly form for Tauri command results.
impl serde::Serialize for ServiceError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

// ---------- Command log channel ----------

/// One-time injected app handle so service modules can `emit` log events
/// without taking AppHandle as a parameter on every helper.
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

pub fn install_app_handle(handle: AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommandLogEntry {
    pub id: String,
    pub started_at: String,
    pub finished_at: String,
    pub duration_ms: i64,
    pub program: String,
    pub args: Vec<String>,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub error: Option<String>,
}

/// Emit a `command:log` event for the UI's bottom panel. The id is a short
/// random suffix so the UI can dedup or thread entries.
pub fn emit_command_log(
    program: &str,
    args: &[&str],
    started_at: chrono::DateTime<chrono::Utc>,
    exit_code: i32,
    stdout: &str,
    stderr: &str,
    error: Option<&str>,
) {
    let Some(handle) = APP_HANDLE.get() else { return };

    let finished_at = chrono::Utc::now();
    let duration_ms = (finished_at - started_at).num_milliseconds();

    let entry = CommandLogEntry {
        id: format!("{:08x}", rand::random::<u32>()),
        started_at: started_at.to_rfc3339(),
        finished_at: finished_at.to_rfc3339(),
        duration_ms,
        program: program.to_string(),
        args: redact_args(args),
        exit_code,
        stdout: truncate(redact(stdout).as_str(), 16 * 1024),
        stderr: truncate(stderr, 16 * 1024),
        error: error.map(|e| e.to_string()),
    };

    let _ = handle.emit("command:log", entry);
}

/// Best-effort redaction of obvious secret material (long hex strings that
/// look like keys or PINs) in free-text command output. Conservative so we
/// don't munge real output.
fn redact(s: &str) -> String {
    // 16+ contiguous hex chars in stdout get masked. Catches GP keys
    // (32 hex) and 16-byte PUKs that a tool might echo back.
    let re = regex::Regex::new(r"\b[0-9A-Fa-f]{16,}\b").unwrap();
    re.replace_all(s, |c: &regex::Captures| {
        let len = c[0].len();
        format!("<{}-char-hex>", len)
    }).into_owned()
}

/// True if a CLI flag carries secret material as its following value.
/// Keys (`-k`, `--key*`), lock/unlock keys, and PIN/PUK/passphrase flags
/// all hide their value; everything else (AIDs, CAP paths, reader names,
/// `--delete`/`--install`/`--create`, …) stays readable.
fn flag_carries_secret(flag: &str) -> bool {
    let f = flag.trim_start_matches('-').to_ascii_lowercase();
    f == "k"
        || f.contains("key")
        || f.contains("lock") // --lock <newkey>, --unlock <key>
        || f.contains("pin")
        || f.contains("puk")
        || f.contains("pass")
}

/// Redact an argv while keeping public tokens (AIDs, CAP paths, sub-commands,
/// reader names) legible. A token is masked only when the preceding flag
/// carries a secret, or when it uses the inline `--flag=secret` form. This is
/// deliberately context-aware: blanket hex masking also hid AIDs, which made
/// the command log useless for diagnosing installs/deletes.
fn redact_args(args: &[&str]) -> Vec<String> {
    let mut out = Vec::with_capacity(args.len());
    let mut prev_secret_flag = false;
    for &a in args {
        // Inline form: --key=DEADBEEF…
        if a.starts_with('-') {
            if let Some(eq) = a.find('=') {
                let (flag, val) = a.split_at(eq);
                if flag_carries_secret(flag) {
                    out.push(format!("{}=<{}-char-hidden>", flag, val.len().saturating_sub(1)));
                    prev_secret_flag = false;
                    continue;
                }
            }
        }
        if prev_secret_flag {
            out.push(format!("<{}-char-hidden>", a.len()));
            prev_secret_flag = false;
            continue;
        }
        prev_secret_flag = a.starts_with('-') && flag_carries_secret(a);
        out.push(a.to_string());
    }
    out
}

#[cfg(test)]
mod redact_tests {
    use super::*;

    #[test]
    fn masks_key_value_keeps_aid() {
        let args = ["-r", "SONY", "-k", "404142434445464748494A4B4C4D4E4F",
                    "--delete", "F276A288BCFBA69D34F310", "--force"];
        let r = redact_args(&args);
        assert_eq!(r[1], "SONY");                 // reader name stays
        assert_eq!(r[3], "<32-char-hidden>");     // key hidden
        assert_eq!(r[5], "F276A288BCFBA69D34F310"); // AID stays readable
        assert_eq!(r[6], "--force");
    }

    #[test]
    fn masks_lock_key_and_inline_form() {
        assert_eq!(redact_args(&["--lock", "0011223344556677"])[1], "<16-char-hidden>");
        assert_eq!(redact_args(&["--key=DEADBEEFDEADBEEF"])[0], "--key=<16-char-hidden>");
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max { s.to_string() }
    else {
        let mut out = s[..max].to_string();
        out.push_str("\n…(truncated)");
        out
    }
}

// ---------- Tool execution ----------
//
// Some tools (notably `gp`) are not installed as real binaries on the
// user's PATH — they're shell aliases (`alias gp='java -jar gp.jar'`)
// or functions defined in `.zshrc`. Our startup PATH-fixup catches
// `/opt/homebrew/bin` etc. but it cannot pick up aliases or functions
// — those only exist inside the shell process.
//
// exec_tool spawns the requested program directly first (fast path).
// If that fails with NotFound, we fall back to the user's login shell,
// force-source the usual rc files, and let the shell resolve the name.
// We remember which tools needed the fallback so subsequent calls skip
// the direct attempt.

static SHELL_FALLBACK_CACHE: OnceLock<Mutex<HashMap<String, bool>>> = OnceLock::new();

fn shell_fallback_cache() -> &'static Mutex<HashMap<String, bool>> {
    SHELL_FALLBACK_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn shell_quote(s: &str) -> String {
    if s.is_empty() {
        return "''".to_string();
    }
    if s.chars().all(|c| c.is_ascii_alphanumeric() || "-_./@%+=:,".contains(c)) {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for c in s.chars() {
        if c == '\'' { out.push_str("'\\''"); }
        else { out.push(c); }
    }
    out.push('\'');
    out
}

fn build_shell_script(tool: &str, args: &[&str]) -> (String, String) {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let shell_name = std::path::Path::new(&shell)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("zsh");

    let prelude = match shell_name {
        "zsh" => r#"[ -f /etc/zshenv ] && . /etc/zshenv;[ -f "$HOME/.zshenv" ] && . "$HOME/.zshenv";[ -f /etc/zprofile ] && . /etc/zprofile;[ -f "$HOME/.zprofile" ] && . "$HOME/.zprofile";[ -f /etc/zshrc ] && . /etc/zshrc;[ -f "$HOME/.zshrc" ] && . "$HOME/.zshrc" 2>/dev/null;"#,
        "bash" => r#"[ -f /etc/profile ] && . /etc/profile;[ -f "$HOME/.bash_profile" ] && . "$HOME/.bash_profile";[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc" 2>/dev/null;"#,
        _ => "",
    };

    let mut inner = shell_quote(tool);
    for arg in args {
        inner.push(' ');
        inner.push_str(&shell_quote(arg));
    }

    (shell, format!("{} {}", prelude, inner))
}

/// Run a tool, falling back to the user's login shell if direct spawn
/// returns NotFound. Returns the same Output the caller would get from
/// `Command::new(tool).args(args).output()`.
pub async fn exec_tool(tool: &str, args: &[&str]) -> std::io::Result<std::process::Output> {
    use tokio::process::Command;

    let needs_shell = {
        let m = shell_fallback_cache().lock().unwrap();
        *m.get(tool).unwrap_or(&false)
    };

    if !needs_shell {
        let direct = Command::new(tool).args(args).output().await;
        match direct {
            Ok(out) => return Ok(out),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                shell_fallback_cache()
                    .lock()
                    .unwrap()
                    .insert(tool.to_string(), true);
            }
            Err(e) => return Err(e),
        }
    }

    let (shell, script) = build_shell_script(tool, args);
    // `-i` is critical: many users guard their alias / function /
    // PATH-additions in .zshrc behind `[[ -o interactive ]]` (or it is
    // a conditional plugin load such as oh-my-zsh). Without `-i` those
    // blocks are skipped and `command not found` slips past even after
    // we sourced .zshrc by hand. `-l` covers .zprofile.
    Command::new(&shell).arg("-lic").arg(&script).output().await
}
