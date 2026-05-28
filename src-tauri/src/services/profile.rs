//! Profile persistence backed by tauri-plugin-store (JSON in user data dir).

use super::{Result, ServiceError};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::path::PathBuf;
use std::fs;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pkcs15Spec {
    pub label: String,
    pub manufacturer: String,
    pub serial_scheme: String, // "cplc" | "uuid" | "incremental" | "template"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub serial_template: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PinSpec {
    pub length_min: u8,
    pub length_max: u8,
    pub generation: String, // "random" | "fixed" | "user-chosen"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fixed_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PukSpec {
    pub length: u8,
    pub generation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fixed_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyPlanEntry {
    pub slot_id: u8,
    pub label: String,
    #[serde(rename = "type")]
    pub key_type: String, // "rsa" | "ec"
    pub size: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub curve: Option<String>,
    pub cert_validity_days: u32,
    pub cert_subject_template: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaSpec {
    pub url: String,
    pub root_cert_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_cert_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_key_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub pkcs15: Pkcs15Spec,
    pub pin: PinSpec,
    pub puk: PukSpec,
    pub keys: Vec<KeyPlanEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ca: Option<CaSpec>,
}

/// In-memory cache fronting the on-disk store. Loaded lazily on first call.
static CACHE: Mutex<Option<Vec<Profile>>> = Mutex::new(None);

fn store_path() -> Result<PathBuf> {
    // For early-stage development we store profiles in $XDG_CONFIG_HOME or
    // platform equivalent under "smartcard-issuer/profiles.json". When
    // wired through tauri-plugin-store, this should be replaced with the
    // App handle's PathResolver. Keep the surface identical.
    let base = dirs_base().ok_or_else(|| ServiceError::Other("no config dir".into()))?;
    let dir = base.join("smartcard-issuer");
    fs::create_dir_all(&dir)?;
    Ok(dir.join("profiles.json"))
}

#[cfg(target_os = "macos")]
fn dirs_base() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support"))
}
#[cfg(target_os = "linux")]
fn dirs_base() -> Option<PathBuf> {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
}
#[cfg(target_os = "windows")]
fn dirs_base() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(PathBuf::from)
}

fn load() -> Result<Vec<Profile>> {
    let mut cache = CACHE.lock().map_err(|e| ServiceError::Store(e.to_string()))?;
    if let Some(c) = cache.clone() {
        return Ok(c);
    }
    let path = store_path()?;
    let data = if path.exists() {
        fs::read_to_string(&path)?
    } else {
        "[]".to_string()
    };
    let parsed: Vec<Profile> = serde_json::from_str(&data)
        .map_err(|e| ServiceError::Parse(format!("profiles.json: {e}")))?;
    *cache = Some(parsed.clone());
    Ok(parsed)
}

fn persist(profiles: &[Profile]) -> Result<()> {
    let path = store_path()?;
    let json = serde_json::to_string_pretty(profiles)
        .map_err(|e| ServiceError::Store(e.to_string()))?;
    fs::write(&path, json)?;
    let mut cache = CACHE.lock().map_err(|e| ServiceError::Store(e.to_string()))?;
    *cache = Some(profiles.to_vec());
    Ok(())
}

pub fn list() -> Result<Vec<Profile>> {
    load()
}

pub fn save(profile: Profile) -> Result<()> {
    let mut all = load()?;
    if let Some(existing) = all.iter_mut().find(|p| p.id == profile.id) {
        *existing = profile;
    } else {
        all.push(profile);
    }
    persist(&all)
}

pub fn delete(id: &str) -> Result<()> {
    let mut all = load()?;
    all.retain(|p| p.id != id);
    persist(&all)
}
