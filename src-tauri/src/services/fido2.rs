//! FIDO2 authenticator management via libfido2's `fido2-token` CLI.
//!
//! Operations require a connected authenticator (USB or NFC reader holding
//! a CTAP2 card). Listing credentials needs the PIN.

use super::{Result, ServiceError};
use serde::{Deserialize, Serialize};
use tokio::process::Command;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fido2Device {
    pub path: String,
    pub product: String,
    pub vendor: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fido2Info {
    pub path: String,
    pub aaguid: Option<String>,
    pub versions: Vec<String>,
    pub extensions: Vec<String>,
    pub options: Vec<(String, bool)>,
    pub pin_retries: Option<u32>,
    pub uv_retries: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidentCredential {
    pub rp_id: String,
    pub user_name: Option<String>,
    pub user_display_name: Option<String>,
    pub credential_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCredentialRequest {
    pub device_path: String,
    pub credential_id: String,
    pub pin: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetPinRequest {
    pub device_path: String,
    pub old_pin: Option<String>, // None on first setup
    pub new_pin: String,
}

/// `fido2-token -L` -> list devices.
pub async fn list_devices() -> Result<Vec<Fido2Device>> {
    let out = Command::new("fido2-token")
        .arg("-L")
        .output()
        .await
        .map_err(|e| if e.kind() == std::io::ErrorKind::NotFound {
            ServiceError::NotFound("fido2-token".into())
        } else {
            ServiceError::Io(e)
        })?;
    if !out.status.success() {
        return Err(ServiceError::Command(
            "fido2-token -L".into(),
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stderr).into_owned(),
        ));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(parse_device_list(&text))
}

fn parse_device_list(text: &str) -> Vec<Fido2Device> {
    // Lines look like:
    // ioreg://4295033394: vendor=0x1050, product=0x0407 (Yubico YubiKey...)
    // /dev/hidraw0: vendor=0x1050, product=0x0407 (Yubico YubiKey...)
    let mut out = Vec::new();
    for line in text.lines() {
        let (path, rest) = match line.split_once(':') {
            Some(t) => t,
            None => continue,
        };
        let mut vendor = String::new();
        let mut product = String::new();
        for chunk in rest.split(',') {
            let chunk = chunk.trim();
            if let Some(v) = chunk.strip_prefix("vendor=") {
                vendor = v.trim().to_string();
            }
            if let Some(p) = chunk.strip_prefix("product=") {
                product = p.trim().to_string();
            }
        }
        if let Some(idx) = rest.find('(') {
            if let Some(end) = rest.find(')') {
                product = rest[idx + 1..end].to_string();
            }
        }
        out.push(Fido2Device {
            path: path.trim().to_string(),
            product,
            vendor,
        });
    }
    out
}

/// `fido2-token -I <device>` -> info.
pub async fn info(path: &str) -> Result<Fido2Info> {
    let out = Command::new("fido2-token")
        .args(["-I", path])
        .output()
        .await?;
    if !out.status.success() {
        return Err(ServiceError::Command(
            "fido2-token -I".into(),
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stderr).into_owned(),
        ));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(parse_info(path, &text))
}

fn parse_info(path: &str, text: &str) -> Fido2Info {
    let mut aaguid = None;
    let mut versions = Vec::new();
    let mut extensions = Vec::new();
    let mut options: Vec<(String, bool)> = Vec::new();
    let mut pin_retries = None;
    let mut uv_retries = None;

    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("aaguid:") {
            aaguid = Some(rest.trim().to_string());
        } else if let Some(rest) = trimmed.strip_prefix("version strings:") {
            versions = rest.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
        } else if let Some(rest) = trimmed.strip_prefix("extension strings:") {
            extensions = rest.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
        } else if let Some(rest) = trimmed.strip_prefix("options:") {
            for opt in rest.split(',') {
                let opt = opt.trim();
                if let Some(name) = opt.strip_prefix('!') {
                    options.push((name.to_string(), false));
                } else {
                    options.push((opt.to_string(), true));
                }
            }
        } else if let Some(rest) = trimmed.strip_prefix("pin retries:") {
            pin_retries = rest.trim().parse().ok();
        } else if let Some(rest) = trimmed.strip_prefix("uv retries:") {
            uv_retries = rest.trim().parse().ok();
        }
    }

    Fido2Info {
        path: path.to_string(),
        aaguid,
        versions,
        extensions,
        options,
        pin_retries,
        uv_retries,
    }
}

/// List discoverable (resident) credentials. Requires PIN.
pub async fn list_credentials(device_path: &str, pin: &str) -> Result<Vec<ResidentCredential>> {
    // First enumerate RPs with `-L -r <device>`.
    let rps_out = Command::new("fido2-token")
        .args(["-L", "-r", device_path])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()?;
    let _ = pin; // see note below: fido2-token prompts on stdin
    let rps_done = rps_out.wait_with_output().await?;
    let rps_text = String::from_utf8_lossy(&rps_done.stdout);

    let mut creds = Vec::new();
    for line in rps_text.lines() {
        if let Some((idx, rp_id)) = line.split_once(':') {
            let _ = idx;
            let rp_id = rp_id.trim().to_string();
            // For each RP, enumerate credentials with `-L -k <rp_id> <device>`
            let out = Command::new("fido2-token")
                .args(["-L", "-k", &rp_id, device_path])
                .output()
                .await?;
            if !out.status.success() { continue; }
            let txt = String::from_utf8_lossy(&out.stdout);
            for cred_line in txt.lines() {
                let parts: Vec<&str> = cred_line.split(':').collect();
                if parts.len() < 2 { continue; }
                creds.push(ResidentCredential {
                    rp_id: rp_id.clone(),
                    user_name: parts.get(2).map(|s| s.trim().to_string()),
                    user_display_name: parts.get(3).map(|s| s.trim().to_string()),
                    credential_id: parts.get(1).unwrap_or(&"").trim().to_string(),
                });
            }
        }
    }
    Ok(creds)
}

/// `fido2-token -D -i <cred_id> <device>` (PIN provided via env var so it
/// stays off argv).
pub async fn delete_credential(req: DeleteCredentialRequest) -> Result<()> {
    let out = Command::new("fido2-token")
        .args(["-D", "-i", &req.credential_id, &req.device_path])
        .env("FIDO_DEVTIMEOUT", "10")
        // PIN is read from stdin by fido2-token when -p not given. We write it.
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;
    use tokio::io::AsyncWriteExt;
    if let Some(mut stdin) = out.stdin.take() {
        stdin.write_all(req.pin.as_bytes()).await?;
        stdin.write_all(b"\n").await?;
    }
    drop(out.stdin.take());
    let result = out.wait_with_output().await?;
    if !result.status.success() {
        return Err(ServiceError::Command(
            "fido2-token -D".into(),
            result.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&result.stderr).into_owned(),
        ));
    }
    Ok(())
}

/// Set or change the FIDO2 PIN.
pub async fn set_pin(req: SetPinRequest) -> Result<()> {
    let mut args = vec!["-S".to_string()];
    if req.old_pin.is_some() {
        args.push("-c".to_string());
    }
    args.push(req.device_path.clone());

    let mut cmd = Command::new("fido2-token");
    cmd.args(&args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let child = cmd.spawn()?;
    use tokio::io::AsyncWriteExt;
    if let Some(mut stdin) = child.stdin.take() {
        if let Some(old) = &req.old_pin {
            stdin.write_all(old.as_bytes()).await?;
            stdin.write_all(b"\n").await?;
        }
        stdin.write_all(req.new_pin.as_bytes()).await?;
        stdin.write_all(b"\n").await?;
        stdin.write_all(req.new_pin.as_bytes()).await?;
        stdin.write_all(b"\n").await?;
    }
    let result = child.wait_with_output().await?;
    if !result.status.success() {
        return Err(ServiceError::Command(
            "fido2-token -S".into(),
            result.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&result.stderr).into_owned(),
        ));
    }
    Ok(())
}

/// Factory reset (within 10s of plugging in / waking the authenticator).
pub async fn reset(device_path: &str) -> Result<()> {
    let out = Command::new("fido2-token")
        .args(["-R", device_path])
        .output()
        .await?;
    if !out.status.success() {
        return Err(ServiceError::Command(
            "fido2-token -R".into(),
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stderr).into_owned(),
        ));
    }
    Ok(())
}
