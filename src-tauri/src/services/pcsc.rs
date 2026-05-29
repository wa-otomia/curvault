//! Reader enumeration + card snapshot.
//!
//! We deliberately shell out to opensc-tool rather than linking pcsc-rs to
//! keep the dependency surface small. If raw APDU access is later required,
//! swap in `pcsc` crate behind the same API.

use super::{gp, opensc, Result};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardInfo {
    pub reader: String,
    pub atr: String,
    pub cplc: Option<gp::Cplc>,
    pub applets: Vec<gp::Applet>,
    pub gp_version: Option<String>,
}

pub async fn list_readers() -> Result<Vec<opensc::Reader>> {
    let mut readers = opensc::list_readers().await?;
    for r in readers.iter_mut() {
        // opensc-tool's "Card" column over-reports on contactless readers
        // (latched / mute cards). Confirm by actually powering the card.
        if r.has_card {
            match opensc::probe_card(&r.name, true).await {
                opensc::CardProbe::Present(atr) => {
                    r.has_card = true;
                    r.atr = atr;
                }
                opensc::CardProbe::Absent => r.has_card = false,
                // Busy / transient error: keep the optimistic flag, no ATR.
                opensc::CardProbe::Unknown => {}
            }
        }
    }
    Ok(readers)
}

/// Reader list for the status bar's lightweight poll. Confirms presence the
/// same way (so a latched / mute contactless reader doesn't read as
/// "card present") but emits no command-log entries.
pub async fn list_readers_quiet() -> Result<Vec<opensc::Reader>> {
    let mut readers = opensc::list_readers_quiet().await?;
    for r in readers.iter_mut() {
        if r.has_card {
            match opensc::probe_card(&r.name, false).await {
                opensc::CardProbe::Present(_) => r.has_card = true,
                opensc::CardProbe::Absent => r.has_card = false,
                opensc::CardProbe::Unknown => {}
            }
        }
    }
    Ok(readers)
}

pub async fn inspect(reader: &str) -> Result<CardInfo> {
    let atr = opensc::read_atr(reader).await?.unwrap_or_else(|| "-".into());
    // Try GP info with default test key. If it fails (rotated key), caller
    // can retry with a specific key handle in a separate code path.
    let info = gp::info(reader, None).await.unwrap_or(gp::GpInfo {
        cplc: None,
        gp_version: None,
        applets: vec![],
    });
    Ok(CardInfo {
        reader: reader.to_string(),
        atr,
        cplc: info.cplc,
        applets: info.applets,
        gp_version: info.gp_version,
    })
}
