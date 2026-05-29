//! PKCS#15 initialization wrapper.
//!
//! Drives `pkcs15-init` to lay down a custom token (label, serial number,
//! manufacturer ID) and the user PIN. Manufacturer ID is not exposed by
//! pkcs15-init's command line, so we synthesise a profile file on the fly
//! and point OpenSC at it via OPENSC_PROFILE_DIR.

use super::{emit_command_log, Result, ServiceError};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;
use tokio::process::Command;

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Pkcs15InitRequest {
    pub reader: String,
    /// Token label written into EF.TokenInfo.
    pub label: String,
    /// Manufacturer ID written into EF.TokenInfo (via custom profile).
    pub manufacturer: String,
    /// Hex string for the PKCS#15 serial number.
    pub serial: String,
    /// PIN value. Must be 4..=16 ASCII bytes.
    pub pin: String,
    /// PUK value. Must be exactly 16 ASCII bytes for IsoApplet.
    pub puk: String,
    /// Optional: pre-existing OpenSC profile dir (uses system default if None).
    #[serde(default)]
    pub profile_dir_override: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pkcs15InitResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    /// Vault handle id where the (PIN, PUK) pair was stashed.
    pub credentials_vault_id: String,
}

/// Top-level: synthesise profile dir, run create-pkcs15, run store-pin,
/// stash credentials in the OS keychain, return result.
pub async fn create(req: Pkcs15InitRequest) -> Result<Pkcs15InitResult> {
    validate_lengths(&req)?;

    // 1) Stage a profile dir if a custom manufacturer is requested.
    let profile_dir = match &req.profile_dir_override {
        Some(p) => Some(PathBuf::from(p)),
        None => Some(stage_profile_dir(&req.manufacturer)?),
    };

    // 2) Stash PIN + PUK in vault and never log them.
    let creds_id = stash_credentials(&req)?;

    // 3) pkcs15-init --create-pkcs15
    let create_args: Vec<&str> = vec![
        "-r", &req.reader,
        "--create-pkcs15",
        "--so-pin", &req.puk,        // IsoApplet conflates SO-PIN with PUK
        "--label", &req.label,
        "--serial", &req.serial,
    ];
    let started_at = chrono::Utc::now();
    let mut create = Command::new("pkcs15-init");
    if let Some(dir) = profile_dir.as_ref() {
        create.env("OPENSC_PROFILE_DIR", dir);
    }
    let out = create.args(&create_args).output().await.map_err(map_io("pkcs15-init"))?;
    emit_command_log(
        "pkcs15-init", &create_args, started_at,
        out.status.code().unwrap_or(-1),
        &String::from_utf8_lossy(&out.stdout),
        &String::from_utf8_lossy(&out.stderr),
        None,
    );
    if !out.status.success() {
        return Err(ServiceError::Command(
            "pkcs15-init --create-pkcs15".into(),
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stderr).into_owned(),
        ));
    }

    // 4) pkcs15-init --store-pin  (user PIN against auth-id 01)
    let store_args: Vec<&str> = vec![
        "-r", &req.reader,
        "--store-pin",
        "--auth-id", "01",
        "--label", "User PIN",
        "--pin", &req.pin,
        "--puk", &req.puk,
    ];
    let started_at2 = chrono::Utc::now();
    let mut store = Command::new("pkcs15-init");
    if let Some(dir) = profile_dir.as_ref() {
        store.env("OPENSC_PROFILE_DIR", dir);
    }
    let out2 = store.args(&store_args).output().await.map_err(map_io("pkcs15-init"))?;
    emit_command_log(
        "pkcs15-init", &store_args, started_at2,
        out2.status.code().unwrap_or(-1),
        &String::from_utf8_lossy(&out2.stdout),
        &String::from_utf8_lossy(&out2.stderr),
        None,
    );
    let exit = out2.status.code().unwrap_or(-1);
    Ok(Pkcs15InitResult {
        stdout: format!(
            "{}\n---store-pin---\n{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out2.stdout),
        ),
        stderr: format!(
            "{}\n---store-pin---\n{}",
            String::from_utf8_lossy(&out.stderr),
            String::from_utf8_lossy(&out2.stderr),
        ),
        exit_code: exit,
        credentials_vault_id: creds_id,
    })
}

fn validate_lengths(req: &Pkcs15InitRequest) -> Result<()> {
    if !(4..=16).contains(&req.pin.len()) {
        return Err(ServiceError::Other(format!(
            "PIN length must be 4..=16, got {}",
            req.pin.len()
        )));
    }
    if req.puk.len() != 16 {
        return Err(ServiceError::Other(format!(
            "PUK length must be exactly 16 for IsoApplet, got {}",
            req.puk.len()
        )));
    }
    if req.label.is_empty() {
        return Err(ServiceError::Other("label must not be empty".into()));
    }
    Ok(())
}

fn stash_credentials(req: &Pkcs15InitRequest) -> Result<String> {
    // We piggy-back on the vault module's keychain storage by writing two
    // entries: `pkcs15:<id>:pin` and `pkcs15:<id>:puk`. The id is returned
    // and is the only thing the UI ever sees.
    let id = uuid::Uuid::new_v4().to_string()[..8].to_string();
    let entry_pin = keyring::Entry::new(SERVICE, &format!("pkcs15:{id}:pin"))?;
    entry_pin.set_password(&req.pin)?;
    let entry_puk = keyring::Entry::new(SERVICE, &format!("pkcs15:{id}:puk"))?;
    entry_puk.set_password(&req.puk)?;
    Ok(id)
}

/// Lay down a temporary OpenSC profile dir with manufacturer ID patched in.
fn stage_profile_dir(manufacturer: &str) -> Result<PathBuf> {
    let base = vault_runtime_dir()?;
    let dir = base.join(format!("profile-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&dir)?;

    // Copy whatever system profile we can find. Try a few canonical paths.
    let candidates = [
        "/opt/homebrew/share/opensc",
        "/usr/share/opensc",
        "/usr/local/share/opensc",
    ];
    let src = candidates
        .iter()
        .find(|p| std::path::Path::new(p).join("isoApplet.profile").exists())
        .ok_or_else(|| ServiceError::Other(
            "could not locate system OpenSC profile dir; pass profile_dir_override".into(),
        ))?;

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        if entry.file_name().to_string_lossy().ends_with(".profile") {
            fs::copy(entry.path(), dir.join(entry.file_name()))?;
        }
    }

    // Patch manufacturer in isoApplet.profile via regex on the cardinfo
    // block. If no `manufacturer =` line exists, append one.
    let iso = dir.join("isoApplet.profile");
    let mut content = fs::read_to_string(&iso)?;
    let re = regex::Regex::new(r#"manufacturer\s*=\s*"[^"]*""#).unwrap();
    if re.is_match(&content) {
        content = re.replace(&content, format!("manufacturer = \"{}\"", manufacturer)).into_owned();
    } else {
        content.push_str(&format!("\n\ncardinfo {{\n    manufacturer = \"{}\";\n}}\n", manufacturer));
    }
    fs::write(&iso, content)?;
    Ok(dir)
}

fn vault_runtime_dir() -> Result<PathBuf> {
    let base = std::env::var_os("TMPDIR")
        .or_else(|| std::env::var_os("TEMP"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"));
    let dir = base.join("smartcard-issuer");
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn map_io(prog: &str) -> impl Fn(std::io::Error) -> ServiceError + '_ {
    move |e| match e.kind() {
        std::io::ErrorKind::NotFound => ServiceError::NotFound(prog.to_string()),
        _ => ServiceError::Io(e),
    }
}

/// Convenience: read back a credentials handle (used by issuance flow once
/// it stops being a skeleton).
#[allow(dead_code)]
pub fn read_credentials(id: &str) -> Result<(String, String)> {
    let pin = keyring::Entry::new(SERVICE, &format!("pkcs15:{id}:pin"))?
        .get_password()?;
    let puk = keyring::Entry::new(SERVICE, &format!("pkcs15:{id}:puk"))?
        .get_password()?;
    Ok((pin, puk))
}

const SERVICE: &str = "com.waotomia.curvault";
