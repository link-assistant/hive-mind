// Exercise the public API used by the actual TUI for cross-session prompt recall.
// All inputs come from the bounded synthetic Node driver; no model is contacted.
use codex_config::types::HistoryPersistence;
use codex_message_history::{HistoryBatchCursor, HistoryConfig};
use std::io::{Read, Write};
use std::path::PathBuf;

fn main() -> std::io::Result<()> {
    let mut args = std::env::args().skip(1);
    let operation = args.next().expect("operation");
    let mut config = HistoryConfig {
        codex_home: PathBuf::from(args.next().expect("private configuration")),
        persistence: HistoryPersistence::SaveAll,
        max_bytes: None,
    };
    if operation == "append-disabled" {
        config.persistence = HistoryPersistence::None;
    }
    if operation == "append-capped" {
        config.max_bytes = Some(256);
    }
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    match operation.as_str() {
        "hold-lock" => {
            let root = PathBuf::from(std::env::var_os("CODEX_MESSAGE_HISTORY_HOME").unwrap());
            let guard = std::fs::File::open(root.join(".hive-message-history.lock"))?;
            guard.try_lock().unwrap();
            println!("LOCKED");
            std::io::stdout().flush()?;
            // The parent keeps stdin open, then kills this bounded owner.
            std::io::stdin().read_exact(&mut [0u8; 1])?;
        }
        "append" | "append-disabled" | "append-capped" => {
            let marker = args.next().expect("synthetic marker");
            runtime.block_on(codex_message_history::append_entry(
                &marker,
                "00000000-0000-0000-0000-000000000001",
                &config,
            ))?;
            println!("APPENDED");
        }
        "metadata" => {
            let metadata = runtime.block_on(codex_message_history::history_metadata(&config));
            println!("{}", serde_json::to_string(&metadata)?);
        }
        "append-many" => {
            let count: usize = args.next().expect("finite count").parse().unwrap();
            assert!((1..=140).contains(&count));
            for index in 0..count {
                runtime.block_on(codex_message_history::append_entry(
                    &format!("SYNTHETIC-PAGE-{index}"),
                    "00000000-0000-0000-0000-000000000001",
                    &config,
                ))?;
            }
            println!("APPENDED");
        }
        "reject-id" => {
            let (id, count) = runtime.block_on(codex_message_history::history_metadata(&config));
            assert!(count > 0);
            let wrong = id.checked_add(1).expect("synthetic history identifier");
            assert!(codex_message_history::lookup(wrong, 0, &config).is_none());
            assert!(
                codex_message_history::lookup_batch(
                    wrong,
                    HistoryBatchCursor::new(count - 1),
                    &config
                )?
                .entries
                .is_empty()
            );
            println!("REJECTED");
        }
        "read" => {
            let (current_id, count) =
                runtime.block_on(codex_message_history::history_metadata(&config));
            let id = args
                .next()
                .map_or(current_id, |id| id.parse().expect("history identifier"));
            let mut entries = Vec::new();
            for offset in 0..count {
                let entry = codex_message_history::lookup(id, offset, &config)
                    .expect("native single-row lookup must find each synthetic row");
                entries.push(entry.text);
            }
            if count > 0 {
                let mut cursor = Some(HistoryBatchCursor::new(count - 1));
                let mut batch_entries = Vec::new();
                while let Some(position) = cursor {
                    let batch = codex_message_history::lookup_batch(id, position, &config)?;
                    assert!(!batch.entries.is_empty(), "native batch must make progress");
                    batch_entries.extend(
                        batch
                            .entries
                            .into_iter()
                            .map(|entry| entry.entry.expect("synthetic batch row").text),
                    );
                    assert!(batch_entries.len() <= count, "bounded synthetic pagination");
                    cursor = batch.next_older_cursor;
                }
                assert_eq!(
                    batch_entries,
                    entries.iter().rev().cloned().collect::<Vec<_>>()
                );
            }
            println!("{}", serde_json::to_string(&entries)?);
        }
        _ => panic!("unknown synthetic operation"),
    }
    Ok(())
}
