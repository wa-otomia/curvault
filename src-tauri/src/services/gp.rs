//! Wrapper around the `gp` (GlobalPlatformPro) CLI.

use super::{emit_command_log, exec_tool, Result, ServiceError};
use serde::{Deserialize, Serialize};

/// Trim a PC/SC reader name down to a contiguous run of safe characters
/// (letters and digits) so it can survive shells, aliases backed by eval,
/// and gp's own regex matcher. The shortened token is still distinctive
/// in practice because reader names start with the vendor brand.
fn safe_reader_key(reader: &str) -> String {
    let mut out = String::new();
    for c in reader.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.is_empty() {
            break;
        }
    }
    if out.is_empty() { reader.to_string() } else { out }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Cplc {
    pub ic_fabricator: String,
    pub ic_type: String,
    pub os_id: String,
    pub ic_serial_number: String,
    pub ic_batch_identifier: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Applet {
    pub aid: String,
    pub state: String,
    pub parent: Option<String>,
    pub privileges: Option<Vec<String>>,
    pub kind: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpInfo {
    pub cplc: Option<Cplc>,
    pub gp_version: Option<String>,
    pub applets: Vec<Applet>,
}

#[derive(Debug, Serialize)]
pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

async fn run_gp(reader: Option<&str>, key_hex: Option<&str>, args: &[&str]) -> Result<CommandResult> {
    let started_at = chrono::Utc::now();

    // gp's -r option matches reader names against a regex. Names from
    // opensc-tool / PC/SC often contain spaces, slashes, parentheses,
    // and dots — passing them through a shell that re-parses (some gp
    // installs are zsh aliases backed by `eval`) corrupts the value.
    // We shrink the name to a unique-enough prefix containing only
    // safe characters; gp's regex match keeps the right reader.
    let reader_key = reader.map(safe_reader_key);

    let mut full_args: Vec<&str> = Vec::new();
    if let Some(ref r) = reader_key { full_args.push("-r"); full_args.push(r); }
    if let Some(k) = key_hex { full_args.push("-k"); full_args.push(k); }
    full_args.extend_from_slice(args);

    let result = exec_tool("gp", &full_args).await;

    match &result {
        Ok(out) => emit_command_log(
            "gp",
            &full_args,
            started_at,
            out.status.code().unwrap_or(-1),
            &String::from_utf8_lossy(&out.stdout),
            &String::from_utf8_lossy(&out.stderr),
            None,
        ),
        Err(e) => emit_command_log(
            "gp",
            &full_args,
            started_at,
            -1,
            "",
            "",
            Some(&e.to_string()),
        ),
    }

    let out = result.map_err(|e| if e.kind() == std::io::ErrorKind::NotFound {
        ServiceError::NotFound("gp".into())
    } else {
        ServiceError::Io(e)
    })?;

    Ok(CommandResult {
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        exit_code: out.status.code().unwrap_or(-1),
    })
}

pub async fn info(reader: &str, key_hex: Option<&str>) -> Result<GpInfo> {
    let r = run_gp(Some(reader), key_hex, &["--info", "--list"]).await?;
    if r.exit_code != 0 {
        return Err(ServiceError::Command("gp --info".into(), r.exit_code, r.stderr));
    }
    Ok(parse_info_output(&r.stdout))
}

fn parse_info_output(text: &str) -> GpInfo {
    let cplc = parse_cplc(text);
    let gp_version = text
        .lines()
        .find(|l| l.contains("GP Version:"))
        .and_then(|l| l.split("GP Version:").nth(1))
        .map(|s| s.trim().to_string());
    let applets = parse_applets(text);
    GpInfo { cplc, gp_version, applets }
}

fn parse_cplc(text: &str) -> Option<Cplc> {
    let pick = |key: &str| -> Option<String> {
        text.lines()
            .find(|l| l.trim().starts_with(key))
            .and_then(|l| l.split('=').nth(1))
            .map(|s| s.split_whitespace().next().unwrap_or("").to_string())
    };
    Some(Cplc {
        ic_fabricator:       pick("ICFabricator")?,
        ic_type:             pick("ICType")?,
        os_id:               pick("OperatingSystemID")?,
        ic_serial_number:    pick("ICSerialNumber")?,
        ic_batch_identifier: pick("ICBatchIdentifier").unwrap_or_default(),
    })
}

fn parse_applets(text: &str) -> Vec<Applet> {
    let mut out = Vec::new();
    let mut current: Option<Applet> = None;
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("ISD:")
            .or_else(|| trimmed.strip_prefix("APP:"))
            .or_else(|| trimmed.strip_prefix("PKG:"))
        {
            if let Some(c) = current.take() { out.push(c); }
            let kind = if trimmed.starts_with("ISD:") { "ISD" }
                       else if trimmed.starts_with("APP:") { "APP" }
                       else { "PKG" }.to_string();
            let mut parts = rest.split_whitespace();
            let aid = parts.next().unwrap_or("").to_string();
            let state = parts
                .next()
                .map(|s| s.trim_matches(|c: char| c == '(' || c == ')').to_string())
                .unwrap_or_else(|| "UNKNOWN".into());
            current = Some(Applet { aid, state, parent: None, privileges: None, kind });
        } else if let Some(parent) = trimmed.strip_prefix("Parent:") {
            if let Some(ref mut c) = current { c.parent = Some(parent.trim().to_string()); }
        } else if let Some(privs) = trimmed.strip_prefix("Privs:") {
            if let Some(ref mut c) = current {
                c.privileges = Some(privs.split(',').map(|s| s.trim().to_string()).collect());
            }
        }
    }
    if let Some(c) = current { out.push(c); }
    out
}

pub async fn install_cap(
    reader: &str,
    key_hex: Option<&str>,
    cap_path: &str,
    instance_aid: Option<&str>,
) -> Result<CommandResult> {
    let mut args: Vec<&str> = vec!["--install", cap_path];
    if let Some(iaid) = instance_aid {
        args.push("--create");
        args.push(iaid);
    }
    run_gp(Some(reader), key_hex, &args).await
}

pub async fn uninstall_package(reader: &str, key_hex: Option<&str>, package_aid: &str) -> Result<CommandResult> {
    run_gp(Some(reader), key_hex, &["--uninstall", package_aid]).await
}

pub async fn lock_to_key(reader: &str, current_key: Option<&str>, new_key_hex: &str) -> Result<CommandResult> {
    run_gp(Some(reader), current_key, &["--lock", new_key_hex]).await
}
