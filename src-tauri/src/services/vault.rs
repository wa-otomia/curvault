//! GP key vault.
//!
//! - Key bytes live in the OS keychain (keyring crate).
//! - Per-handle metadata (alias, card serial, note, created_at) lives in
//!   a small JSON file in the user data dir, so the UI can list them
//!   without the keychain prompting for every entry.

use super::{Result, ServiceError};
use chrono::Utc;
use keyring::Entry;
use rand::RngCore;
use serde::{Deserialize, Serialize};
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
}

#[derive(Default, Serialize, Deserialize)]
struct VaultMeta {
    handles: Vec<GpKeyHandle>,
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

fn load() -> Result<VaultMeta> {
    let mut guard = META.lock().map_err(|e| ServiceError::Store(e.to_string()))?;
    if let Some(m) = guard.as_ref() {
        return Ok(VaultMeta { handles: m.handles.clone() });
    }
    let path = meta_path()?;
    let parsed: VaultMeta = if path.exists() {
        let data = fs::read_to_string(&path)?;
        serde_json::from_str(&data).map_err(|e| ServiceError::Parse(e.to_string()))?
    } else {
        VaultMeta::default()
    };
    *guard = Some(VaultMeta { handles: parsed.handles.clone() });
    Ok(parsed)
}

fn persist(m: &VaultMeta) -> Result<()> {
    let path = meta_path()?;
    let json = serde_json::to_string_pretty(m).map_err(|e| ServiceError::Store(e.to_string()))?;
    fs::write(&path, json)?;
    let mut guard = META.lock().map_err(|e| ServiceError::Store(e.to_string()))?;
    *guard = Some(VaultMeta { handles: m.handles.clone() });
    Ok(())
}

pub fn list() -> Result<Vec<GpKeyHandle>> {
    Ok(load()?.handles)
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

    Entry::new(SERVICE, &id)?.set_password(&hex_key)?;

    let handle = GpKeyHandle {
        id: id.clone(),
        card_serial,
        algorithm: "SCP02".into(),
        key_length_bytes: 16,
        created_at: Utc::now().to_rfc3339(),
        note,
    };

    let mut m = load()?;
    m.handles.retain(|h| h.id != id);
    m.handles.push(handle.clone());
    persist(&m)?;

    Ok(handle)
}

pub fn read_key_hex(id: &str) -> Result<String> {
    Ok(Entry::new(SERVICE, id)?.get_password()?)
}

pub fn delete(id: &str) -> Result<()> {
    let entry = Entry::new(SERVICE, id)?;
    let _ = entry.delete_credential();   // best-effort: tolerate missing
    let mut m = load()?;
    m.handles.retain(|h| h.id != id);
    persist(&m)?;
    Ok(())
}
