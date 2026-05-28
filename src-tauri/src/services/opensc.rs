//! Wrappers around `opensc-tool`, `pkcs15-init`, `pkcs15-tool`.

use super::{emit_command_log, Result, ServiceError};
use serde::Serialize;
use tokio::process::Command;

#[derive(Debug, Serialize, Clone)]
pub struct Reader {
    pub name: String,
    #[serde(rename = "hasCard")]
    pub has_card: bool,
    pub atr: Option<String>,
}

/// `opensc-tool -l` -> list of readers with card presence + ATR.
pub async fn list_readers() -> Result<Vec<Reader>> {
    let started_at = chrono::Utc::now();
    let args = ["-l"];
    let res = Command::new("opensc-tool").args(args).output().await;

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

/// `opensc-tool -an -r <reader>` → ATR of card in given reader.
pub async fn read_atr(reader: &str) -> Result<Option<String>> {
    let started_at = chrono::Utc::now();
    let args = ["-r", reader, "-an"];
    let res = Command::new("opensc-tool").args(args).output().await;

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
