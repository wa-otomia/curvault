pub mod gp;
pub mod opensc;
pub mod pcsc;
pub mod vault;
pub mod profile;
pub mod issuance;
pub mod pkcs15;
pub mod fido2;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum ServiceError {
    #[error("command '{0}' failed (exit {1}): {2}")]
    Command(String, i32, String),

    #[error("command '{0}' not found in PATH — install it and try again")]
    NotFound(String),

    #[error("parse error: {0}")]
    Parse(String),

    #[error("keychain error: {0}")]
    Keychain(#[from] keyring::Error),

    #[error("store error: {0}")]
    Store(String),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, ServiceError>;

/// Convert errors into a string-friendly form for Tauri command results.
impl serde::Serialize for ServiceError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}
