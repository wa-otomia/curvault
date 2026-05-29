//! GP key vault with a keychain-first, file-fallback storage strategy.
//!
//! Preferred: the OS keychain (keyring crate, native backend per platform).
//! Fallback: if a keychain write cannot be read straight back — which
//! happens on ad-hoc-signed macOS builds whose code signature is not
//! trusted for the data-protection keychain — the key is stored in a
//! 0600-permission JSON file in the user data dir instead. Either way the
//! UI only ever sees a handle id; the raw key reaches gp once per command.
//!
//! Each handle records which backend holds its key, so reads go to the
//! right place.

use super::{Result, ServiceError};
use chrono::Utc;
use keyring::Entry;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

const SERVICE: &str = "com.waotomia.curvault";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpKeyHandle {
    pub id: String,
    pub card_serial: Option<String>,
    pub algorithm: String,
    pub key_length_bytes: usize,
    pub created_at: String,
    pub note: Option<String>,
    /// "keychain" or "file" — where the secret bytes actually live.
    #[serde(default = "default_backend")]
    pub backend: String,
}

fn default_backend() -> String {
    "keychain".to_string()
}

#[derive(Default, Serialize, Deserialize)]
struct VaultMeta {
    handles: Vec<GpKeyHandle>,
    /// File-backed key material: handle id -> hex key. Only populated when
    /// the OS keychain refused the write.
    #[serde(default)]
    file_keys: HashMap<String, String>,
}

static META: Mutex<Option<VaultMeta>> = Mutex::new(None);

fn meta_path() -> Result<PathBuf> {
    let base = data_dir().ok_or_else(|| ServiceError::Other("no config dir".into()))?;
    let dir = base.join("curvault");
    fs::create_dir_all(&dir)?;
    Ok(dir.join("vault.json"))
}

#[cfg(target_os = "macos")]
fn data_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
}
#[cfg(target_os = "linux")]
fn data_dir() -> Option<PathBuf> {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
}
#[cfg(target_os = "windows")]
fn data_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(PathBuf::from)
}

#[cfg(unix)]
fn lock_perms(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
}
#[cfg(not(unix))]
fn lock_perms(_path: &std::path::Path) {}

fn load() -> Result<VaultMeta> {
    let mut guard = META.lock().map_err(|e| ServiceError::Store(e.to_string()))?;
    if let Some(m) = guard.as_ref() {
        return Ok(VaultMeta { handles: m.handles.clone(), file_keys: m.file_keys.clone() });
    }
    let path = meta_path()?;
    let parsed: VaultMeta = if path.exists() {
        let data = fs::read_to_string(&path)?;
        serde_json::from_str(&data).map_err(|e| ServiceError::Parse(e.to_string()))?
    } else {
        VaultMeta::default()
    };
    *guard = Some(VaultMeta { handles: parsed.handles.clone(), file_keys: parsed.file_keys.clone() });
    Ok(parsed)
}

fn persist(m: &VaultMeta) -> Result<()> {
    let path = meta_path()?;
    let json = serde_json::to_string_pretty(m).map_err(|e| ServiceError::Store(e.to_string()))?;
    fs::write(&path, json)?;
    lock_perms(&path); // owner-only — file_keys may hold secret bytes
    let mut guard = META.lock().map_err(|e| ServiceError::Store(e.to_string()))?;
    *guard = Some(VaultMeta { handles: m.handles.clone(), file_keys: m.file_keys.clone() });
    Ok(())
}

pub fn list() -> Result<Vec<GpKeyHandle>> {
    Ok(load()?.handles)
}

/// Try to round-trip a key through the OS keychain. Returns true only if a
/// write followed by an immediate read gives the same value back.
fn keychain_roundtrip(id: &str, hex_key: &str) -> bool {
    let write = Entry::new(SERVICE, id).and_then(|e| e.set_password(hex_key));
    if write.is_err() {
        return false;
    }
    match Entry::new(SERVICE, id).and_then(|e| e.get_password()) {
        Ok(back) => back == hex_key,
        Err(_) => false,
    }
}

pub fn generate(card_serial: Option<String>, note: Option<String>) -> Result<GpKeyHandle> {
    let id = format!(
        "gp-key:{}",
        card_serial
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()[..8].to_string())
    );

    let mut bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut bytes);
    let hex_key = hex::encode_upper(bytes);

    let backend = if keychain_roundtrip(&id, &hex_key) {
        "keychain"
    } else {
        "file"
    };

    let mut m = load()?;
    if backend == "file" {
        m.file_keys.insert(id.clone(), hex_key.clone());
    } else {
        // In case a previous file-backed entry with this id existed.
        m.file_keys.remove(&id);
    }

    let handle = GpKeyHandle {
        id: id.clone(),
        card_serial,
        algorithm: "SCP02".into(),
        key_length_bytes: 16,
        created_at: Utc::now().to_rfc3339(),
        note,
        backend: backend.to_string(),
    };
    m.handles.retain(|h| h.id != id);
    m.handles.push(handle.clone());
    persist(&m)?;

    Ok(handle)
}

pub fn read_key_hex(id: &str) -> Result<String> {
    let m = load()?;
    let backend = m
        .handles
        .iter()
        .find(|h| h.id == id)
        .map(|h| h.backend.clone())
        .unwrap_or_else(|| "keychain".to_string());

    if backend == "file" {
        return m.file_keys.get(id).cloned().ok_or_else(|| {
            ServiceError::Other(format!(
                "Key '{id}' is recorded as file-backed but its bytes are missing \
                 from the vault file. Delete this handle and generate a new key."
            ))
        });
    }

    Entry::new(SERVICE, id)?
        .get_password()
        .map_err(|e| {
            let msg = e.to_string();
            if msg.contains("No matching entry") || msg.contains("NoEntry") {
                ServiceError::Other(format!(
                    "Key '{id}' is missing from the OS keychain. Delete this row \
                     and generate a fresh GP key (newer builds fall back to a \
                     local 0600 file when the keychain is unavailable)."
                ))
            } else {
                ServiceError::Keychain(e)
            }
        })
}

pub fn delete(id: &str) -> Result<()> {
    // Best-effort keychain removal — tolerate missing.
    let _ = Entry::new(SERVICE, id).and_then(|e| e.delete_credential());
    let mut m = load()?;
    m.handles.retain(|h| h.id != id);
    m.file_keys.remove(id);
    persist(&m)?;
    Ok(())
}
