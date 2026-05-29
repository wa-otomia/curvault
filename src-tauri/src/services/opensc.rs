//! Wrappers around `opensc-tool`, `pkcs15-init`, `pkcs15-tool`.

use super::{emit_command_log, exec_tool, Result, ServiceError};
use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
pub struct Reader {
    pub name: String,
    #[serde(rename = "hasCard")]
    pub has_card: bool,
    pub atr: Option<String>,
}

/// `opensc-tool -l` -> list of readers with card presence + ATR.
/// Emits a command-log entry.
pub async fn list_readers() -> Result<Vec<Reader>> {
    list_readers_inner(true).await
}

/// Same listing but WITHOUT emitting a command-log entry. Used by the
/// status bar's periodic poll so the bottom-of-window card count stays
/// fresh without flooding the command log every few seconds.
pub async fn list_readers_quiet() -> Result<Vec<Reader>> {
    list_readers_inner(false).await
}

async fn list_readers_inner(log: bool) -> Result<Vec<Reader>> {
    let started_at = chrono::Utc::now();
    let args = ["-l"];
    let res = exec_tool("opensc-tool", &args).await;

    if log {
        match &res {
            Ok(out) => emit_command_log(
                "opensc-tool", &args, started_at,
                out.status.code().unwrap_or(-1),
                &String::from_utf8_lossy(&out.stdout),
                &String::from_utf8_lossy(&out.stderr),
                None,
            ),
            Err(e) => emit_command_log(
                "opensc-tool", &args, started_at, -1, "", "", Some(&e.to_string()),
            ),
        }
    }

    let out = res.map_err(|e| if e.kind() == std::io::ErrorKind::NotFound {
        ServiceError::NotFound("opensc-tool".into())
    } else {
        ServiceError::Io(e)
    })?;
    if !out.status.success() {
        return Err(ServiceError::Command(
            "opensc-tool -l".into(),
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stderr).into_owned(),
        ));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(parse_reader_list(&text))
}

/// Parse the `opensc-tool -l` listing. Sample (macOS, OpenSC 0.25):
///
/// ```text
/// # Detected readers (pcsc)
/// Nr.  Card  Features  Name
/// 0    Yes             SONY FeliCa Port/PaSoRi 4.0
/// 1    No   PIN pad    Identiv SCR3500 USB Smart Card Reader
/// ```
///
/// The Features column is variable-width and may be empty, so we anchor the
/// Name column at the byte offset of "Name" in the header row.
fn parse_reader_list(text: &str) -> Vec<Reader> {
    let lines: Vec<&str> = text.lines().collect();

    let header_idx = lines
        .iter()
        .position(|l| l.trim_start().starts_with("Nr."));
    let name_offset = header_idx
        .and_then(|i| lines.get(i))
        .and_then(|h| h.find("Name"));

    let mut out = Vec::new();
    let start = header_idx.map(|i| i + 1).unwrap_or(0);
    for line in lines.iter().skip(start) {
        let trimmed = line.trim_end();
        if trimmed.is_empty()
            || trimmed.trim_start().starts_with('#')
            || trimmed.trim_start().starts_with("Nr.")
        {
            continue;
        }

        // First two whitespace-separated tokens are always Nr. and Card.
        let mut tokens = trimmed.split_whitespace();
        let _nr = match tokens.next() { Some(x) => x, None => continue };
        let card = match tokens.next() { Some(x) => x, None => continue };

        // Name: anchor at the header offset if we got one, otherwise take
        // everything from the third token onward.
        let name = if let Some(off) = name_offset {
            if line.len() > off { line[off..].trim().to_string() }
            else { tokens.collect::<Vec<_>>().join(" ").trim().to_string() }
        } else {
            tokens.collect::<Vec<_>>().join(" ").trim().to_string()
        };

        if name.is_empty() {
            continue;
        }

        out.push(Reader {
            name,
            has_card: card.eq_ignore_ascii_case("yes"),
            atr: None,
        });
    }
    out
}

/// `pkcs15-tool --reader <r> --dump` → dump of all PKCS#15 objects.
pub async fn dump_pkcs15(reader: &str) -> Result<String> {
    let started_at = chrono::Utc::now();
    let args = ["--reader", reader, "--dump"];
    let res = exec_tool("pkcs15-tool", &args).await;

    match &res {
        Ok(out) => emit_command_log(
            "pkcs15-tool", &args, started_at,
            out.status.code().unwrap_or(-1),
            &String::from_utf8_lossy(&out.stdout),
            &String::from_utf8_lossy(&out.stderr),
            None,
        ),
        Err(e) => emit_command_log(
            "pkcs15-tool", &args, started_at, -1, "", "", Some(&e.to_string()),
        ),
    }

    let out = res.map_err(|e| if e.kind() == std::io::ErrorKind::NotFound {
        ServiceError::NotFound("pkcs15-tool".into())
    } else {
        ServiceError::Io(e)
    })?;
    if !out.status.success() {
        return Err(ServiceError::Command(
            "pkcs15-tool --dump".into(),
            out.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&out.stderr).into_owned(),
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Try a list of well-known opensc-pkcs11 module paths and return the first
/// one that actually exists on disk.
fn detect_pkcs11_module() -> Option<String> {
    let candidates = [
        "/opt/homebrew/lib/opensc-pkcs11.so",
        "/usr/local/lib/opensc-pkcs11.so",
        "/usr/lib/x86_64-linux-gnu/opensc-pkcs11.so",
        "/usr/lib/opensc-pkcs11.so",
        "/usr/lib64/opensc-pkcs11.so",
        "C:\\Program Files\\OpenSC Project\\OpenSC\\pkcs11\\opensc-pkcs11.dll",
    ];
    for p in candidates {
        if std::path::Path::new(p).exists() {
            return Some(p.to_string());
        }
    }
    None
}

/// `pkcs11-tool --module ... --list-slots --list-objects` → text dump.
pub async fn dump_pkcs11(module: Option<&str>) -> Result<String> {
    let resolved = match module {
        Some(m) => m.to_string(),
        None => detect_pkcs11_module().ok_or_else(|| {
            ServiceError::Other(
                "opensc-pkcs11 module not found in standard locations; \
                 install OpenSC or pass the module path explicitly.".into(),
            )
        })?,
    };

    let started_at = chrono::Utc::now();
    let args = ["--module", &resolved, "--list-slots", "--list-objects"];
    let res = exec_tool("pkcs11-tool", &args).await;

    match &res {
        Ok(out) => emit_command_log(
            "pkcs11-tool", &args, started_at,
            out.status.code().unwrap_or(-1),
            &String::from_utf8_lossy(&out.stdout),
            &String::from_utf8_lossy(&out.stderr),
            None,
        ),
        Err(e) => emit_command_log(
            "pkcs11-tool", &args, started_at, -1, "", "", Some(&e.to_string()),
        ),
    }

    let out = res.map_err(|e| if e.kind() == std::io::ErrorKind::NotFound {
        ServiceError::NotFound("pkcs11-tool".into())
    } else {
        ServiceError::Io(e)
    })?;
    Ok(format!(
        "module: {}\n\n{}{}",
        resolved,
        String::from_utf8_lossy(&out.stdout),
        if out.stderr.is_empty() { String::new() }
        else { format!("\n--- stderr ---\n{}", String::from_utf8_lossy(&out.stderr)) },
    ))
}

/// `opensc-tool -an -r <reader>` → ATR of card in given reader.
pub async fn read_atr(reader: &str) -> Result<Option<String>> {
    let started_at = chrono::Utc::now();
    let args = ["-r", reader, "-an"];
    let res = exec_tool("opensc-tool", &args).await;

    match &res {
        Ok(out) => emit_command_log(
            "opensc-tool", &args, started_at,
            out.status.code().unwrap_or(-1),
            &String::from_utf8_lossy(&out.stdout),
            &String::from_utf8_lossy(&out.stderr),
            None,
        ),
        Err(e) => emit_command_log(
            "opensc-tool", &args, started_at, -1, "", "", Some(&e.to_string()),
        ),
    }

    let out = res?;
    if !out.status.success() {
        return Ok(None);
    }
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(text.lines().next().map(|l| l.trim().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_features_column_empty() {
        let s = "\
# Detected readers (pcsc)
Nr.  Card  Features  Name
0    Yes             SONY FeliCa Port/PaSoRi 4.0
";
        let r = parse_reader_list(s);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].name, "SONY FeliCa Port/PaSoRi 4.0");
        assert!(r[0].has_card);
    }

    #[test]
    fn parses_features_column_populated() {
        let s = "\
# Detected readers (pcsc)
Nr.  Card  Features  Name
0    No    PIN pad   Identiv SCR3500 USB Smart Card Reader
1    Yes             Generic Reader
";
        let r = parse_reader_list(s);
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].name, "Identiv SCR3500 USB Smart Card Reader");
        assert!(!r[0].has_card);
        assert_eq!(r[1].name, "Generic Reader");
        assert!(r[1].has_card);
    }
}
