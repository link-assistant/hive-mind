//! Generation fencing for native ChatGPT refresh. Not a complete backend gate.
use super::Transaction;
use std::io;

#[cfg(target_os = "linux")]
use super::super::super::storage::canonical_auth::CanonicalAuth;
#[cfg(target_os = "linux")]
use sha2::{Digest, Sha256};

fn refused() -> io::Error {
    io::Error::other("Canonical refresh outcome is unresolved or unsafe.")
}

#[cfg(target_os = "linux")]
fn digest(kind: &[u8], secret: &str) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(kind);
    hash.update(secret.as_bytes());
    hash.finalize().into()
}

#[cfg(target_os = "linux")]
fn generation(bytes: &[u8]) -> io::Result<[u8; 32]> {
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| refused())?;
    // Hash the actual predecessor, not formatting or last_refresh metadata.
    // Rewriting those fields must not authorize another use of consumed G0.
    if let Some(token) = value
        .get("tokens")
        .and_then(|v| v.get("refresh_token"))
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty())
    {
        return Ok(digest(b"oauth\0", token));
    }
    if let Some(key) = value
        .get("OPENAI_API_KEY")
        .and_then(|v| v.as_str())
        .filter(|v| !v.is_empty())
    {
        return Ok(digest(b"api\0", key));
    }
    Err(refused())
}

impl Transaction {
    pub(crate) fn assert_refresh_readable() -> io::Result<()> {
        #[cfg(target_os = "linux")]
        if let Some(shared) = CanonicalAuth::configured()? {
            let before = shared.refresh_intent()?;
            if let Some(predecessor) = before {
                let current = generation(&shared.read()?.ok_or_else(refused)?)?;
                if current == predecessor {
                    return Err(refused());
                }
                // G1 was published before a crash during intent cleanup.
                shared.sync_current_auth()?;
                if generation(&shared.read()?.ok_or_else(refused)?)? != current {
                    return Err(refused());
                }
            }
            if shared.refresh_intent()? != before {
                return Err(refused());
            }
        }
        Ok(())
    }

    pub(crate) fn reconcile_refresh(&self) -> io::Result<()> {
        #[cfg(target_os = "linux")]
        if let Some(guard) = &self.guard {
            if let Some(predecessor) = guard.refresh_intent()? {
                if let Some(bytes) = guard.auth_bytes()? {
                    // Native login/logout acquire this lock before repairing
                    // malformed credentials. Leave uncertainty intact when no
                    // valid generation can be read; request admission and
                    // begin_refresh_exchange still refuse these bytes.
                    let Ok(current) = generation(&bytes) else {
                        return Ok(());
                    };
                    if current != predecessor {
                        guard.sync_current_auth()?;
                        if generation(&guard.auth_bytes()?.ok_or_else(refused)?)? != current {
                            return Err(refused());
                        }
                        guard.finish_refresh(&predecessor)?;
                    }
                }
            }
        }
        Ok(())
    }

    pub(crate) fn begin_refresh_exchange(&self, expected: &str) -> io::Result<()> {
        #[cfg(target_os = "linux")]
        if let Some(guard) = &self.guard {
            self.reconcile_refresh()?;
            let expected = digest(b"oauth\0", expected);
            if generation(&guard.auth_bytes()?.ok_or_else(refused)?)? != expected {
                return Err(refused());
            }
            guard.begin_refresh(&expected)?;
            if generation(&guard.auth_bytes()?.ok_or_else(refused)?)? != expected {
                return Err(refused());
            }
        }
        Ok(())
    }

    pub(crate) fn finish_refresh_exchange(&self, expected: &str) -> io::Result<()> {
        #[cfg(target_os = "linux")]
        if let Some(guard) = &self.guard {
            // Called only after a successful native durable credential commit.
            // A provider may legitimately retain the same refresh token.
            guard.sync_current_auth()?;
            guard.finish_refresh(&digest(b"oauth\0", expected))?;
        }
        Ok(())
    }
}
