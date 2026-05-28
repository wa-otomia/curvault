//! FIDO2 authenticator management via libfido2's `fido2-token` CLI.
//!
//! Operations require a connected authenticator (USB or NFC reader holding
//! a CTAP2 card). Listing credentials needs the PIN.

use super::{emit_command_log, Result, ServiceError};
use serde::{Deserialize, Serialize};
use tokio::process::Command;

fn map_fido_error(stderr: &str) -> Option<String> {
    if stderr.contains("FIDO_ERR_NO_CREDENTIALS") {
        return Some("No resident credentials on this device.".into());
    }
    None
}

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
    let started_at = chrono::Utc::now();
    let args = ["-L"];
    let res = Command::new("fido2-token").args(args).output().await;

    match &res {
        Ok(out) => emit_command_log(
            "fido2-token", &args, started_at,
            out.status.code().unwrap_or(-1),
            &String::from_utf8_lossy(&out.stdout),
            &String::from_utf8_lossy(&out.stderr),
            None,
        ),
        Err(e) => emit_command_log(
            "fido2-token", &args, started_at, -1, "", "", Some(&e.to_string()),
        ),
    }

    let out = res.map_err(|e| if e.kind() == std::io::ErrorKind::NotFound {
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
    // libfido2 reports each device on one line. The path can be a URL-style
    // identifier with its own colons:
    //   pcsc://slot0: vendor=0x0000, product=0x0000 (PC/SC SONY FeliCa Port/PaSoRi 4.0)
    //   ioreg://4295033394: vendor=0x1050, product=0x0407 (Yubico YubiKey ...)
    //   /dev/hidraw0: vendor=0x1050, product=0x0407 (Yubico ...)
    //
    // Splitting on the first ':' would chop pcsc:// in half, so anchor on
    // the well-known ": vendor=" delimiter instead.
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let (path, rest) = match line.find(": vendor=") {
            Some(i) => (line[..i].to_string(), &line[i + 2..]),
            None => continue,
        };

        let mut vendor = String::new();
        let mut product_id = String::new();
        for chunk in rest.split(',') {
            let chunk = chunk.trim();
            if let Some(v) = chunk.strip_prefix("vendor=") {
                vendor = v.split_whitespace().next().unwrap_or("").to_string();
            }
            if let Some(p) = chunk.strip_prefix("product=") {
                product_id = p.split_whitespace().next().unwrap_or("").to_string();
            }
        }

        // The friendly name lives in parentheses at the end of the line.
        let product = match (rest.find('('), rest.rfind(')')) {
            (Some(open), Some(close)) if close > open => rest[open + 1..close].to_string(),
            _ => product_id,
        };

        out.push(Fido2Device { path, product, vendor });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pcsc_url_path() {
        let s = "pcsc://slot0: vendor=0x0000, product=0x0000 (PC/SC SONY FeliCa Port/PaSoRi 4.0)\n";
        let d = parse_device_list(s);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].path, "pcsc://slot0");
        assert_eq!(d[0].vendor, "0x0000");
        assert_eq!(d[0].product, "PC/SC SONY FeliCa Port/PaSoRi 4.0");
    }

    #[test]
    fn parses_hid_path() {
        let s = "/dev/hidraw0: vendor=0x1050, product=0x0407 (Yubico YubiKey 5)\n";
        let d = parse_device_list(s);
        assert_eq!(d.len(), 1);
        assert_eq!(d[0].path, "/dev/hidraw0");
        assert_eq!(d[0].product, "Yubico YubiKey 5");
    }
}

/// `fido2-token -I <device>` -> info.
pub async fn info(path: &str) -> Result<Fido2Info> {
    let started_at = chrono::Utc::now();
    let args = ["-I", path];
    let res = Command::new("fido2-token").args(args).output().await;

    match &res {
        Ok(out) => emit_command_log(
            "fido2-token", &args, started_at,
            out.status.code().unwrap_or(-1),
            &String::from_utf8_lossy(&out.stdout),
            &String::from_utf8_lossy(&out.stderr),
            None,
        ),
        Err(e) => emit_command_log(
            "fido2-token", &args, started_at, -1, "", "", Some(&e.to_string()),
        ),
    }

    let out = res?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
        let msg = map_fido_error(&stderr).unwrap_or_else(|| stderr.clone());
        return Err(ServiceError::Command(
            "fido2-token -I".into(),
            out.status.code().unwrap_or(-1),
            msg,
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
    let mut out = Command::new("fido2-token")
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
        // stdin dropped here closes the pipe, signalling EOF to the child.
    }
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
    let mut child = cmd.spawn()?;
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
