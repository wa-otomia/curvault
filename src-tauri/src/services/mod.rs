pub mod gp;
pub mod opensc;
pub mod pcsc;
pub mod vault;
pub mod profile;
pub mod issuance;
pub mod pkcs15;
pub mod fido2;

use std::sync::OnceLock;
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
        args: args.iter().map(|s| redact(s)).collect(),
        exit_code,
        stdout: truncate(redact(stdout).as_str(), 16 * 1024),
        stderr: truncate(stderr, 16 * 1024),
        error: error.map(|e| e.to_string()),
    };

    let _ = handle.emit("command:log", entry);
}

/// Best-effort redaction of obvious secret material (long hex strings that
/// look like keys or PINs). Conservative so we don't munge real output.
fn redact(s: &str) -> String {
    // 16+ contiguous hex chars in argv or stdout get masked. Catches GP
    // keys (32 hex) and 16-byte PUKs.
    let re = regex::Regex::new(r"\b[0-9A-Fa-f]{16,}\b").unwrap();
    re.replace_all(s, |c: &regex::Captures| {
        let len = c[0].len();
        format!("<{}-char-hex>", len)
    }).into_owned()
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max { s.to_string() }
    else {
        let mut out = s[..max].to_string();
        out.push_str("\n…(truncated)");
        out
    }
}
