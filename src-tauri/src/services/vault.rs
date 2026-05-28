//! Secret material lives in the OS keychain.
//!
//! - macOS:   Keychain
//! - Windows: Credential Manager
//! - Linux:   libsecret / kwallet
//!
//! Metadata (handle id, card serial binding, note, created_at) lives in the
//! tauri-plugin-store JSON. The actual key bytes are only ever in:
//!   1. the OS keychain (at rest), and
//!   2. a short-lived `String` during exactly one `gp` invocation.
//! No log line, no IPC payload, no disk file ever sees the key in cleartext.

use super::Result;
use chrono::Utc;
use keyring::Entry;
use rand::RngCore;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "com.waotomia.curvault";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpKeyHandle {
    pub id: String,
    pub card_serial: Option<String>,
    pub algorithm: String, // "SCP02" or "SCP03"
    pub key_length_bytes: usize,
    pub created_at: String,
    pub note: Option<String>,
}

/// Generate 16 random bytes, store hex in keychain, return the handle.
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

    let entry = Entry::new(SERVICE, &id)?;
    entry.set_password(&hex_key)?;

    Ok(GpKeyHandle {
        id,
        card_serial,
        algorithm: "SCP02".into(),
        key_length_bytes: 16,
        created_at: Utc::now().to_rfc3339(),
        note,
    })
}

/// Fetch the raw hex key for a handle. Caller is responsible for not leaking it.
pub fn read_key_hex(id: &str) -> Result<String> {
    let entry = Entry::new(SERVICE, id)?;
    Ok(entry.get_password()?)
}

/// Remove a handle from the keychain. Metadata cleanup is the store's job.
pub fn delete(id: &str) -> Result<()> {
    let entry = Entry::new(SERVICE, id)?;
    entry.delete_credential()?;
    Ok(())
}
