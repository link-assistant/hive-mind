//! One descriptor lock for every participating native writer and token exchange.
//! Lock ordering: manager semaphore, cross-process descriptor, storage mutex.
//! Never acquire the descriptor recursively; internal commits borrow its guard.
use std::io;
use std::time::{Duration, Instant};

#[cfg(target_os = "linux")]
use super::super::storage::canonical_auth::{CanonicalAuth, RefreshLock};

const WAIT: Duration = Duration::from_secs(60);
const POLL: Duration = Duration::from_millis(25);

pub(super) fn selected() -> bool {
    std::env::var_os("CODEX_AUTH_HOME").is_some()
}

pub(super) struct Transaction {
    #[cfg(target_os = "linux")]
    guard: Option<RefreshLock>,
}

impl Transaction {
    pub(super) fn assert_current(&self) -> io::Result<()> {
        #[cfg(target_os = "linux")]
        if let Some(guard) = &self.guard {
            return guard.assert_current();
        }
        Ok(())
    }

    pub(super) fn acquire() -> io::Result<Self> {
        #[cfg(target_os = "linux")]
        {
            let Some(mut shared) = CanonicalAuth::configured()? else {
                return Ok(Self { guard: None });
            };
            let deadline = Instant::now() + WAIT;
            loop {
                match shared.try_lock()? {
                    Ok(guard) => return Ok(Self { guard: Some(guard) }),
                    Err(waiting) => shared = waiting,
                }
                if Instant::now() >= deadline {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "Canonical authentication transaction is busy.",
                    ));
                }
                std::thread::sleep(POLL);
            }
        }
        #[cfg(not(target_os = "linux"))]
        if selected() {
            Err(io::Error::other(
                "Canonical authentication requires the Linux storage adapter.",
            ))
        } else {
            Ok(Self {})
        }
    }

    pub(super) async fn acquire_async() -> io::Result<Self> {
        #[cfg(target_os = "linux")]
        {
            let Some(mut shared) = CanonicalAuth::configured()? else {
                return Ok(Self { guard: None });
            };
            let deadline = Instant::now() + WAIT;
            loop {
                match shared.try_lock()? {
                    Ok(guard) => return Ok(Self { guard: Some(guard) }),
                    Err(waiting) => shared = waiting,
                }
                if Instant::now() >= deadline {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "Canonical authentication transaction is busy.",
                    ));
                }
                tokio::time::sleep(POLL).await;
            }
        }
        #[cfg(not(target_os = "linux"))]
        Self::acquire()
    }
}
