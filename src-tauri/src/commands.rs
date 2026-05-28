//! Tauri command surface. All `invoke()` calls from the renderer enter here.

use crate::services::{gp, opensc, pcsc, profile, vault, issuance};
use crate::services::Result;
use serde::Deserialize;
use std::collections::HashMap;

// ---------- Readers / Card ----------

#[tauri::command]
pub async fn list_readers() -> Result<Vec<opensc::Reader>> {
    pcsc::list_readers().await
}

#[tauri::command]
pub async fn inspect_card(reader: String) -> Result<pcsc::CardInfo> {
    pcsc::inspect(&reader).await
}

// ---------- GP key vault ----------

#[tauri::command]
pub fn list_gp_keys() -> Result<Vec<vault::GpKeyHandle>> {
    // For early-stage development we keep handle metadata co-located with
    // profiles. A separate store will land before v0.2.
    Ok(vec![])
}

#[tauri::command]
pub fn generate_gp_key(card_serial: Option<String>, note: Option<String>) -> Result<vault::GpKeyHandle> {
    vault::generate(card_serial, note)
}

#[tauri::command]
pub fn delete_gp_key(id: String) -> Result<()> {
    vault::delete(&id)
}

#[tauri::command]
pub async fn lock_gp_key(reader: String, key_id: String) -> Result<gp::CommandResult> {
    let new_key = vault::read_key_hex(&key_id)?;
    // Pass None for current key → gp defaults to test keys.
    let r = gp::lock_to_key(&reader, None, &new_key).await?;
    if r.exit_code != 0 {
        return Err(crate::services::ServiceError::Command(
            "gp --lock".into(),
            r.exit_code,
            r.stderr.clone(),
        ));
    }
    Ok(r)
}

// ---------- Applet management ----------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallParams {
    pub cap_path: String,
    pub package_aid: String,
    pub applet_aid: String,
    #[serde(default)]
    pub instance_aid: Option<String>,
}

#[tauri::command]
pub async fn install_applet(
    reader: String,
    gp_key_id: Option<String>,
    params: InstallParams,
) -> Result<gp::CommandResult> {
    let key_hex = match gp_key_id {
        Some(id) => Some(vault::read_key_hex(&id)?),
        None => None,
    };
    gp::install_cap(
        &reader,
        key_hex.as_deref(),
        &params.cap_path,
        params.instance_aid.as_deref(),
    ).await
}

#[tauri::command]
pub async fn uninstall_applet(
    reader: String,
    gp_key_id: Option<String>,
    package_aid: String,
) -> Result<gp::CommandResult> {
    let key_hex = match gp_key_id {
        Some(id) => Some(vault::read_key_hex(&id)?),
        None => None,
    };
    gp::uninstall_package(&reader, key_hex.as_deref(), &package_aid).await
}

// ---------- Profiles ----------

#[tauri::command]
pub fn list_profiles() -> Result<Vec<profile::Profile>> {
    profile::list()
}

#[tauri::command]
pub fn save_profile(profile: profile::Profile) -> Result<()> {
    profile::save(profile)
}

#[tauri::command]
pub fn delete_profile(id: String) -> Result<()> {
    profile::delete(&id)
}

// ---------- Issuance ----------

#[tauri::command]
pub async fn run_issuance(
    reader: String,
    profile_id: String,
    subject_vars: HashMap<String, String>,
) -> Result<issuance::IssuanceReport> {
    issuance::run(&reader, &profile_id, subject_vars).await
}
