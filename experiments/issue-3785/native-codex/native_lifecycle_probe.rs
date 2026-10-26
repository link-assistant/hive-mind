//! Synthetic process driver for the real codex-login manager, with no core/TUI
//! dependency. Parent supplies only disposable homes and a loopback token stub.
use codex_login::{AuthCredentialsStoreMode, AuthKeyringBackendKind, AuthManager};
use std::io;
use std::path::PathBuf;
use std::time::{Duration, Instant};

#[tokio::main(worker_threads = 2)]
async fn main() -> io::Result<()> {
    let mode = std::env::args()
        .nth(1)
        .ok_or_else(|| io::Error::other("Missing mode."))?;
    let home = PathBuf::from(
        std::env::var_os("CODEX_HOME").ok_or_else(|| io::Error::other("Missing home."))?,
    );
    let manager = AuthManager::new(
        home.clone(),
        false,
        AuthCredentialsStoreMode::File,
        None,
        None,
        AuthKeyringBackendKind::default(),
        codex_login::test_support::transport_default_auth_route_config(),
    )
    .await;
    if manager.auth_cached().is_none() {
        return Err(io::Error::other(
            "Synthetic initial canonical auth was not loaded.",
        ));
    }
    let ready = PathBuf::from(
        std::env::var_os("SYNTHETIC_READY").ok_or_else(|| io::Error::other("Missing barrier."))?,
    );
    let release = PathBuf::from(
        std::env::var_os("SYNTHETIC_RELEASE")
            .ok_or_else(|| io::Error::other("Missing release."))?,
    );
    std::fs::write(ready, b"ready")?;
    let deadline = Instant::now() + Duration::from_secs(15);
    while !release.exists() {
        if Instant::now() >= deadline {
            return Err(io::Error::other("Synthetic barrier expired."));
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    if let Some(started) = std::env::var_os("SYNTHETIC_STARTED") {
        std::fs::write(started, b"started")?;
    }
    match mode.as_str() {
        "refresh" => {
            manager
                .refresh_token_from_authority()
                .await
                .map_err(|_| io::Error::other("Synthetic native refresh failed."))?;
            if std::env::var_os("SYNTHETIC_EXPECT_ROTATED").as_deref()
                == Some(std::ffi::OsStr::new("0"))
            {
                println!("PASS: native manager refresh transaction.");
                return Ok(());
            }
            let tokens = manager
                .auth()
                .await
                .ok_or_else(|| io::Error::other("Auth unavailable."))?
                .get_token_data()?;
            if tokens.access_token != "SYNTHETIC-ACCESS-G1" {
                return Err(io::Error::other(
                    "Native peer did not observe the committed generation.",
                ));
            }
        }
        "read-replacement" => {
            if manager
                .auth()
                .await
                .and_then(|auth| auth.api_key().map(str::to_owned))
                .as_deref()
                != Some("sk-SYNTHETIC-G1")
            {
                return Err(io::Error::other(
                    "Native cached read missed canonical replacement.",
                ));
            }
        }
        "read-logout" => {
            if manager.auth().await.is_some() {
                return Err(io::Error::other(
                    "Native cached read missed canonical logout.",
                ));
            }
        }
        "read-cached-replacement" => {
            let tokens = manager
                .auth_cached()
                .ok_or_else(|| io::Error::other("Canonical auth unavailable."))?
                .get_token_data()?;
            if tokens.access_token != "SYNTHETIC-ACCESS-G1" {
                return Err(io::Error::other(
                    "Synchronous native auth read missed canonical replacement.",
                ));
            }
        }
        "read-cached-logout" => {
            if manager.auth_cached().is_some() {
                return Err(io::Error::other(
                    "Synchronous native auth read missed canonical logout.",
                ));
            }
        }
        "write-login" => codex_login::login_with_api_key(
            &home,
            "sk-SYNTHETIC-G1",
            AuthCredentialsStoreMode::File,
            AuthKeyringBackendKind::default(),
        )?,
        "write-logout" => {
            manager.logout().await?;
        }
        _ => return Err(io::Error::other("Unknown synthetic mode.")),
    }
    println!("PASS: native manager lifecycle boundary.");
    Ok(())
}
