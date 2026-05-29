//! FIDO2 authenticator management via libfido2's `fido2-token` CLI.
//!
//! Operations require a connected authenticator (USB or NFC reader holding
//! a CTAP2 card). Listing credentials needs the PIN.

use super::{emit_command_log, exec_tool, Result, ServiceError};
use serde::{Deserialize, Serialize};
use tokio::process::Command;

fn map_fido_error(stderr: &str) -> Option<String> {
    if stderr.contains("FIDO_ERR_NO_CREDENTIALS") {
        return Some("No resident credentials on this device.".into());
    }
    if stderr.contains("FIDO_ERR_PIN_REQUIRED") {
        // Credential management (CTAP2.1 credMgmt) needs a pinUvAuthToken,
        // which only exists once a PIN is set. A blank authenticator simply
        // has nothing to manage — surface that as guidance, not a failure.
        return Some(
            "This authenticator requires a PIN before its resident credentials \
             can be listed or managed. Set a PIN first, or enter the existing PIN."
                .into(),
        );
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
    let res = exec_tool("fido2-token", &args).await;

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
    let res = exec_tool("fido2-token", &args).await;

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

/// List discoverable (resident) credentials. PIN is required by libfido2
/// and is read from stdin — we write it ourselves so the call never hangs.
///
/// libfido2 splits the listing into two steps:
///   1) `fido2-token -L -r <device>` -> list of RP IDs that have
///      resident credentials. Output rows look like:
///         00: 0xa1b2…  example.com
///   2) `fido2-token -L -k <rp_id> <device>` -> credentials per RP. Rows:
///         00: <cred_id_b64>: <user_id_b64>: <type>
///
/// Both calls prompt on stdin.
pub async fn list_credentials(device_path: &str, pin: &str) -> Result<Vec<ResidentCredential>> {
    use tokio::io::AsyncWriteExt;

    async fn run_with_pin(args: &[&str], pin: &str) -> Result<(String, String, i32)> {
        let started_at = chrono::Utc::now();
        let mut child = Command::new("fido2-token")
            .args(args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?;
        if let Some(mut stdin) = child.stdin.take() {
            // Empty PIN -> the authenticator has no clientPin set. Don't
            // feed a blank line (fido2-token would treat it as a wrong
            // PIN); just close stdin so the tool proceeds without PIN
            // auth and enumerates directly.
            if !pin.is_empty() {
                stdin.write_all(pin.as_bytes()).await?;
                stdin.write_all(b"\n").await?;
            }
            // stdin dropped here -> EOF.
        }
        let out = child.wait_with_output().await?;
        let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
        let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
        let code = out.status.code().unwrap_or(-1);
        emit_command_log("fido2-token", args, started_at, code, &stdout, &stderr, None);
        Ok((stdout, stderr, code))
    }

    // Step 1: list RPs.
    let (rp_stdout, rp_stderr, rp_code) =
        run_with_pin(&["-L", "-r", device_path], pin).await?;
    if rp_code != 0 {
        let msg = map_fido_error(&rp_stderr).unwrap_or(rp_stderr);
        return Err(ServiceError::Command("fido2-token -L -r".into(), rp_code, msg));
    }

    let mut rps: Vec<String> = Vec::new();
    for line in rp_stdout.lines() {
        // Format: "<idx>: <hash>  <rp_id>"  — rp_id is the last whitespace-
        // separated token. Skip empty / header lines.
        let trimmed = line.trim();
        if trimmed.is_empty() { continue; }
        let last = trimmed.split_whitespace().last();
        if let Some(rp) = last {
            // Skip rows that don't look like RP rows (no dot in the rp_id).
            if rp.contains('.') || rp.contains(':') || rp.contains('/') {
                rps.push(rp.to_string());
            }
        }
    }

    // Step 2: per-RP credential enumeration.
    //
    // libfido2 prints each credential as:
    //     <idx>: <cred_id_b64> <display_name|(null)> <user_id_b64> <algo> <uv-flag> <pay-flag>
    // — index has a trailing colon, the other fields are space-separated
    // (display_name can be the literal token `(null)` when not set).
    let mut creds = Vec::new();
    for rp_id in rps {
        let (out, _err, code) =
            run_with_pin(&["-L", "-k", &rp_id, device_path], pin).await?;
        if code != 0 { continue; }
        for cred_line in out.lines() {
            let trimmed = cred_line.trim();
            if trimmed.is_empty() { continue; }

            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            // Need at least: idx + cred_id + display + user_id
            if parts.len() < 4 { continue; }
            if !parts[0].ends_with(':') { continue; } // skip non-row lines

            let cred_id = parts[1].to_string();
            let display_name = match parts[2] {
                "(null)" | "(NULL)" => None,
                s => Some(s.to_string()),
            };
            let user_id = parts[3].to_string();

            creds.push(ResidentCredential {
                rp_id: rp_id.clone(),
                user_name: if user_id.is_empty() { None } else { Some(user_id) },
                user_display_name: display_name,
                credential_id: cred_id,
            });
        }
    }
    Ok(creds)
}

#[cfg(test)]
mod credential_parser_tests {
    use super::*;

    fn parse_one(line: &str) -> Option<ResidentCredential> {
        let mut creds = Vec::new();
        let rp_id = "example.org".to_string();
        let trimmed = line.trim();
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() < 4 { return None; }
        if !parts[0].ends_with(':') { return None; }
        let cred_id = parts[1].to_string();
        let display_name = match parts[2] {
            "(null)" | "(NULL)" => None,
            s => Some(s.to_string()),
        };
        let user_id = parts[3].to_string();
        creds.push(ResidentCredential {
            rp_id: rp_id.clone(),
            user_name: if user_id.is_empty() { None } else { Some(user_id) },
            user_display_name: display_name,
            credential_id: cred_id,
        });
        creds.into_iter().next()
    }

    #[test]
    fn parses_libfido2_credential_row() {
        let line = "00: DneUwQLQGixi+CMQ7C+RXx/== (null) d2ViYXV0aG5pby12YWFn es256 uvopt nopay";
        let c = parse_one(line).expect("should parse");
        assert_eq!(c.credential_id, "DneUwQLQGixi+CMQ7C+RXx/==");
        assert!(c.user_display_name.is_none());
        assert_eq!(c.user_name.as_deref(), Some("d2ViYXV0aG5pby12YWFn"));
    }

    #[test]
    fn parses_row_with_display_name() {
        let line = "02: abc== Alice xyz== es256 uvopt nopay";
        let c = parse_one(line).expect("should parse");
        assert_eq!(c.credential_id, "abc==");
        assert_eq!(c.user_display_name.as_deref(), Some("Alice"));
        assert_eq!(c.user_name.as_deref(), Some("xyz=="));
    }

    #[test]
    fn skips_non_row_line() {
        assert!(parse_one("Enter PIN for pcsc://slot0:").is_none());
        assert!(parse_one("").is_none());
    }
}

/// `fido2-token -D -i <cred_id> <device>` (PIN provided via env var so it
/// stays off argv).
pub async fn delete_credential(req: DeleteCredentialRequest) -> Result<()> {
    use tokio::io::AsyncWriteExt;
    let started_at = chrono::Utc::now();
    let args = ["-D", "-i", &req.credential_id[..], &req.device_path[..]];

    let mut out = Command::new("fido2-token")
        .args(args)
        .env("FIDO_DEVTIMEOUT", "10")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()?;
    if let Some(mut stdin) = out.stdin.take() {
        stdin.write_all(req.pin.as_bytes()).await?;
        stdin.write_all(b"\n").await?;
    }
    let result = out.wait_with_output().await?;

    let stdout = String::from_utf8_lossy(&result.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&result.stderr).into_owned();
    let code = result.status.code().unwrap_or(-1);
    emit_command_log("fido2-token", &args, started_at, code, &stdout, &stderr, None);

    if !result.status.success() {
        return Err(ServiceError::Command("fido2-token -D".into(), code, stderr));
    }
    Ok(())
}

/// Set or change the FIDO2 PIN.
pub async fn set_pin(req: SetPinRequest) -> Result<()> {
    use tokio::io::AsyncWriteExt;
    let started_at = chrono::Utc::now();

    let mut args: Vec<String> = vec!["-S".into()];
    if req.old_pin.is_some() {
        args.push("-c".into());
    }
    args.push(req.device_path.clone());
    let args_ref: Vec<&str> = args.iter().map(String::as_str).collect();

    let mut cmd = Command::new("fido2-token");
    cmd.args(&args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = cmd.spawn()?;
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

    let stdout = String::from_utf8_lossy(&result.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&result.stderr).into_owned();
    let code = result.status.code().unwrap_or(-1);
    emit_command_log("fido2-token", &args_ref, started_at, code, &stdout, &stderr, None);

    if !result.status.success() {
        return Err(ServiceError::Command("fido2-token -S".into(), code, stderr));
    }
    Ok(())
}

/// Factory reset (within 10s of plugging in / waking the authenticator).
pub async fn reset(device_path: &str) -> Result<()> {
    let started_at = chrono::Utc::now();
    let args = ["-R", device_path];
    let res = exec_tool("fido2-token", &args).await;

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
        return Err(ServiceError::Command(
            "fido2-token -R".into(),
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stderr).into_owned(),
        ));
    }
    Ok(())
}
