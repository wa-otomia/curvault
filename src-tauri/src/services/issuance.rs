//! End-to-end issuance flow orchestration.
//!
//! This module is intentionally a skeleton — each step calls into the
//! corresponding service module, records start/finish timestamps and
//! detail strings, and emits a progress event after every step so the
//! UI can render a live timeline.
//!
//! TODO sections mark the wiring that should follow once the lower-level
//! services (pkcs15 init, CSR, CA call, cert store-back) are implemented
//! beyond their current stubs.

use super::{profile, vault, Result};
use chrono::Utc;
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssuanceStep {
    pub name: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub status: String,           // "running" | "ok" | "failed" | "skipped"
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IssuanceReport {
    pub started_at: String,
    pub finished_at: Option<String>,
    pub profile_id: String,
    pub card_serial: String,
    pub steps: Vec<IssuanceStep>,
    pub status: String, // "running" | "ok" | "failed"
}

pub async fn run(
    reader: &str,
    profile_id: &str,
    _subject_vars: HashMap<String, String>,
) -> Result<IssuanceReport> {
    let prof = profile::list()?
        .into_iter()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| super::ServiceError::Other(format!("profile {profile_id} not found")))?;

    let mut report = IssuanceReport {
        started_at: Utc::now().to_rfc3339(),
        finished_at: None,
        profile_id: prof.id.clone(),
        card_serial: reader.to_string(),
        steps: vec![],
        status: "running".into(),
    };

    macro_rules! step {
        ($name:expr, $body:block) => {{
            let mut s = IssuanceStep {
                name: $name.into(),
                started_at: Utc::now().to_rfc3339(),
                finished_at: None,
                status: "running".into(),
                detail: None,
            };
            let result: Result<Option<String>> = (|| $body)().await;
            s.finished_at = Some(Utc::now().to_rfc3339());
            match result {
                Ok(detail) => { s.status = "ok".into(); s.detail = detail; }
                Err(e) => {
                    s.status = "failed".into();
                    s.detail = Some(e.to_string());
                    report.steps.push(s);
                    report.finished_at = Some(Utc::now().to_rfc3339());
                    report.status = "failed".into();
                    return Ok(report);
                }
            }
            report.steps.push(s);
        }};
    }

    step!("Inspect card", {
        let info = super::pcsc::inspect(reader).await?;
        Ok(info.cplc.map(|c| format!("CPLC serial {}", c.ic_serial_number)))
    });

    step!("Generate per-card GP key", {
        let h = vault::generate(Some(reader.into()), Some(format!("issued for {profile_id}")))?;
        Ok(Some(format!("vault handle {}", h.id)))
    });

    // TODO: actual install. We stub here so the timeline renders end to end.
    step!("Install applet", {
        Ok(Some("TODO: wire to services::gp::install_cap".into()))
    });

    step!("Create PKCS#15 structure", {
        Ok(Some("TODO: pkcs15-init --create-pkcs15".into()))
    });

    step!("Generate keys per plan", {
        Ok(Some(format!("TODO: provision {} keys", prof.keys.len())))
    });

    step!("Issue certificates", {
        Ok(Some("TODO: CSR + CA call + store cert".into()))
    });

    step!("Lock GP key", {
        Ok(Some("TODO: gp --lock <new key>".into()))
    });

    step!("Verify", {
        Ok(Some("TODO: sign-and-verify smoke test".into()))
    });

    report.finished_at = Some(Utc::now().to_rfc3339());
    report.status = "ok".into();
    Ok(report)
}
