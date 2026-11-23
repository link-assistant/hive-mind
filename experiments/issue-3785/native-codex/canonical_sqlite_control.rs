//! Small real-SQLx control, independent of the full native CLI build.
#[path = "canonical_sqlite_vfs.rs"]
mod canonical;
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection, SqlitePoolOptions};
use sqlx::{Connection, Executor};
use std::io::{Read, Write};
use std::path::Path;

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let root = Path::new(&args[1]);
    let path = root.join("state_5.sqlite");
    canonical::admit_canonical_sqlite(root)?;
    let options = canonical::options(
        &path,
        SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            .pragma("journal_mode", "WAL"),
    )?;
    let pool = SqlitePoolOptions::new()
        .max_connections(2)
        .connect_with(options.clone())
        .await?;
    pool.execute("CREATE TABLE synthetic(value TEXT)").await?;
    pool.execute("INSERT INTO synthetic VALUES ('before')")
        .await?;
    let mut connection = pool.acquire().await?;
    connection
        .lock_handle()
        .await?
        .set_progress_handler(1, || true);
    let before: String = sqlx::query_scalar("SELECT value FROM synthetic")
        .fetch_one(&mut *connection)
        .await?;
    assert_eq!(before, "before");
    connection.lock_handle().await?.remove_progress_handler();
    let mut ordinary = SqliteConnection::connect("sqlite::memory:").await?;
    ordinary.execute("CREATE TABLE ordinary(value)").await?;
    println!(
        "READY actualSqlx=0.9.0 sqlite={}",
        libsqlite3_sys::SQLITE_VERSION_NUMBER
    );
    std::io::stdout().flush()?;
    let mut signal = [0];
    std::io::stdin().read_exact(&mut signal)?;
    assert_eq!(signal, [b'\n']);
    let rebuild = matches!(args[2].as_str(), "rebuild" | "rebuild-closing");
    if !matches!(args[2].as_str(), "close-only") && !rebuild {
        let after: String = sqlx::query_scalar("SELECT value FROM synthetic")
            .fetch_one(&mut *connection)
            .await?;
        assert_eq!(after, "before");
        connection
            .execute("INSERT INTO synthetic VALUES ('after')")
            .await?;
    }
    if args[2] == "rebuild-open" {
        let error = canonical::backup(&path).unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::WouldBlock);
    }
    if args[2] == "rebuild-closing" {
        // #4055: SQLx closes a dropped connection on its worker thread, after
        // the failed opener has already returned and recovery has started.
        let closing = connection.detach();
        pool.close().await;
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(300));
            drop(closing);
        });
    } else {
        connection.return_to_pool().await;
        pool.close().await;
    }
    if rebuild {
        let backup_path = path.clone();
        let backups =
            tokio::task::spawn_blocking(move || canonical::backup(&backup_path)).await??;
        assert_eq!(backups.len(), 1);
        assert_eq!(backups[0].0, path);
        assert!(backups[0].1.is_file());
        let replacement = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await?;
        replacement
            .execute("CREATE TABLE replacement(value)")
            .await?;
        replacement
            .execute("INSERT INTO replacement VALUES ('new')")
            .await?;
        replacement.close().await;
    }
    ordinary.execute("INSERT INTO ordinary VALUES (1)").await?;
    ordinary.close().await?;
    println!("RESULT actualSqlx=1 ordinary=1 nativeDeadlineHandler=1 close=1");
    Ok(())
}
