//! Wrappers around `opensc-tool`, `pkcs15-init`, `pkcs15-tool`.

use super::{Result, ServiceError};
use serde::Serialize;
use tokio::process::Command;

#[derive(Debug, Serialize, Clone)]
pub struct Reader {
    pub name: String,
    #[serde(rename = "hasCard")]
    pub has_card: bool,
    pub atr: Option<String>,
}

/// `opensc-tool -l` → list of readers with card presence + ATR.
pub async fn list_readers() -> Result<Vec<Reader>> {
    let out = Command::new("opensc-tool")
        .args(["-l"])
        .output()
        .await
        .map_err(|e| if e.kind() == std::io::ErrorKind::NotFound {
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

fn parse_reader_list(text: &str) -> Vec<Reader> {
    // Format:
    //   # Detected readers (pcsc)
    //   Nr.  Card  Features  Name
    //   0    Yes              Generic USB2.0-CRW
    //   1    No               SONY FeliCa Port/PaSoRi 4.0
    let mut out = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("Nr.") {
            continue;
        }
        let mut parts = trimmed.splitn(4, char::is_whitespace).filter(|s| !s.is_empty());
        let _nr = match parts.next() { Some(x) => x, None => continue };
        let card = match parts.next() { Some(x) => x, None => continue };
        let _features = parts.next().unwrap_or("");
        let name = parts.next().unwrap_or("").trim().to_string();
        if name.is_empty() { continue; }
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
    let out = Command::new("opensc-tool")
        .args(["-r", reader, "-an"])
        .output()
        .await?;
    if !out.status.success() {
        return Ok(None);
    }
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(text.lines().next().map(|l| l.trim().to_string()))
}
