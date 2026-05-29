//! Tauri command surface. All `invoke()` calls from the renderer enter here.

use crate::services::{gp, opensc, pcsc, profile, vault, issuance, pkcs15, fido2, updates};
use crate::services::Result;
use serde::Deserialize;
use std::collections::HashMap;

// ---------- Readers / Card ----------

#[tauri::command]
pub async fn list_readers() -> Result<Vec<opensc::Reader>> {
    pcsc::list_readers().await
}

#[tauri::command]
pub async fn list_readers_quiet() -> Result<Vec<opensc::Reader>> {
    pcsc::list_readers_quiet().await
}

#[tauri::command]
pub async fn inspect_card(reader: String) -> Result<pcsc::CardInfo> {
    pcsc::inspect(&reader).await
}

// ---------- GP key vault ----------

#[tauri::command]
pub fn list_gp_keys() -> Result<Vec<vault::GpKeyHandle>> {
    vault::list()
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
#[allow(dead_code)] // package_aid / applet_aid are accepted from the UI for
                    // record-keeping; gp --install derives them from the CAP.
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
    force: bool,
) -> Result<gp::CommandResult> {
    let key_hex = match gp_key_id {
        Some(id) => Some(vault::read_key_hex(&id)?),
        None => None,
    };
    gp::uninstall_package(&reader, key_hex.as_deref(), &package_aid, force).await
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

// ---------- PKCS#15 init ----------

#[tauri::command]
pub async fn pkcs15_create(req: pkcs15::Pkcs15InitRequest) -> Result<pkcs15::Pkcs15InitResult> {
    pkcs15::create(req).await
}

#[tauri::command]
pub async fn pkcs15_dump(reader: String) -> Result<String> {
    opensc::dump_pkcs15(&reader).await
}

#[tauri::command]
pub async fn pkcs11_dump(module: Option<String>) -> Result<String> {
    opensc::dump_pkcs11(module.as_deref()).await
}

// ---------- FIDO2 ----------

#[tauri::command]
pub async fn fido2_list_devices() -> Result<Vec<fido2::Fido2Device>> {
    fido2::list_devices().await
}

#[tauri::command]
pub async fn fido2_info(path: String) -> Result<fido2::Fido2Info> {
    fido2::info(&path).await
}

#[tauri::command]
pub async fn fido2_list_credentials(device_path: String, pin: String) -> Result<Vec<fido2::ResidentCredential>> {
    fido2::list_credentials(&device_path, &pin).await
}

#[tauri::command]
pub async fn fido2_delete_credential(req: fido2::DeleteCredentialRequest) -> Result<()> {
    fido2::delete_credential(req).await
}

#[tauri::command]
pub async fn fido2_set_pin(req: fido2::SetPinRequest) -> Result<()> {
    fido2::set_pin(req).await
}

#[tauri::command]
pub async fn fido2_reset(device_path: String) -> Result<()> {
    fido2::reset(&device_path).await
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

// ---------- Updates ----------

#[tauri::command]
pub async fn check_for_updates() -> Result<updates::UpdateInfo> {
    updates::check().await
}

/// Open (or focus) the standalone software-update window.
#[tauri::command]
pub fn open_updater_window(app: tauri::AppHandle) {
    crate::open_updater(&app);
}

/// Open (or focus) the standalone About window.
#[tauri::command]
pub fn open_about_window(app: tauri::AppHandle) {
    crate::open_about(&app);
}

/// Whether the native PC/SC event monitor is running. When true the frontend
/// reacts to `pcsc://readers` events instead of polling.
#[tauri::command]
pub fn pcsc_event_driven() -> bool {
    crate::services::cardmon::is_active()
}

/// The monitor's latest reader snapshot (cached PC/SC state — never powers a
/// card). None until the first change or if the monitor isn't running.
#[tauri::command]
pub fn pcsc_readers() -> Option<Vec<crate::services::cardmon::ReaderSnapshot>> {
    crate::services::cardmon::last_snapshot()
}
