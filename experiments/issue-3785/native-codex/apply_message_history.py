#!/usr/bin/env python3
"""Project the pinned native TUI prompt history independently of configuration."""
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(sys.argv[1]).resolve(strict=True)
if subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() != "6aaac694803004a63c6f393d153c96d22521a6b9":
    raise SystemExit("Refusing unpinned native source.")
folder = root / "codex-rs/message-history/src"
targets = {folder / "lib.rs": "5296d70335948ca3b1a59ddede75c599ec1c192efa4630b6d8d198ce992703b6",
           folder / "batch.rs": "57e1fbff51ad4c0d759d79e8f8c9e5fabda4cd8632d138948361ce1ee911fc09"}
sources = {}
for target, expected in targets.items():
    sources[target] = target.read_text()
    if hashlib.sha256(sources[target].encode()).hexdigest() != expected:
        raise SystemExit("Refusing changed native prompt-history source.")
module = folder / "canonical_message_history.rs"
if module.exists():
    raise SystemExit("Refusing to overwrite an existing native prompt-history module.")


def replace(target, before, after):
    if sources[target].count(before) != 1:
        raise SystemExit("Ambiguous native prompt-history context; no files changed.")
    sources[target] = sources[target].replace(before, after, 1)


library = folder / "lib.rs"
batch = folder / "batch.rs"
replace(library, "mod batch;", "mod canonical_message_history;\nmod batch;")
replace(library, "    match config.persistence {", '''    if canonical_message_history::selected()
        && (!matches!(config.persistence, HistoryPersistence::SaveAll)
            || config.max_bytes.is_some_and(|limit| limit > 0))
    {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "Canonical prompt history requires complete persistence.",
        ));
    }
    match config.persistence {''')
replace(library, "    // Open the history file for read/write access (append-only on Unix).", '''    if canonical_message_history::selected() {
        tokio::task::spawn_blocking(move || {
            canonical_message_history::append(&path, line.as_bytes())
        }).await??;
        return Ok(());
    }

    // Open the history file for read/write access (append-only on Unix).''')
replace(library, "    history_metadata_for_file(&path).await", '''    if canonical_message_history::selected() {
        return tokio::task::spawn_blocking(move || canonical_message_history::metadata(&path))
            .await.ok().and_then(std::result::Result::ok).unwrap_or((0, 0));
    }
    history_metadata_for_file(&path).await''')
replace(library, "    lookup_history_entry(&path, log_id, offset)", '''    if canonical_message_history::selected() {
        return canonical_message_history::with_history(&path, |path| {
            if log_id != 0 && canonical_message_history::log_id(path)? != log_id {
                return Ok(None);
            }
            Ok(lookup_history_entry(path, 0, offset))
        }).ok().flatten();
    }
    lookup_history_entry(&path, log_id, offset)''')
replace(library, "    let file: File = match OpenOptions::new().read(true).open(path) {", '''    let opened = if canonical_message_history::selected() {
        canonical_message_history::open_read(path)
    } else {
        OpenOptions::new().read(true).open(path)
    };
    let file: File = match opened {''')
replace(batch, "    let mut file = OpenOptions::new().read(true).open(path)?;", '''    if super::canonical_message_history::selected() {
        return super::canonical_message_history::with_history(&path, |path| {
            if log_id != 0 && super::canonical_message_history::log_id(path)? != log_id {
                return Ok(HistoryBatch::default());
            }
            // Atomic publication can replace the file between calls. Retain
            // row offsets, but do not reuse a prior data-file byte anchor.
            let mut canonical_config = config.clone();
            canonical_config.max_bytes = Some(0);
            lookup_batch_for_file(path, 0, cursor, &canonical_config)
        });
    }
    lookup_batch_for_file(&path, log_id, cursor, config)
}

fn lookup_batch_for_file(
    path: &std::path::Path,
    log_id: u64,
    cursor: HistoryBatchCursor,
    config: &HistoryConfig,
) -> std::io::Result<HistoryBatch> {
    let mut file = if super::canonical_message_history::selected() {
        super::canonical_message_history::open_read(path)?
    } else {
        OpenOptions::new().read(true).open(path)?
    };''')
for target, source in sources.items():
    sources[target] = subprocess.run(
        ["rustfmt", "--edition", "2024", "--config", "skip_children=true"],
        input=source, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
    ).stdout
if "--check" in sys.argv[2:]:
    print("Pinned canonical prompt-history patch is applicable; no files changed.")
else:
    shutil.copyfile(Path(__file__).with_name(module.name), module)
    for target, source in sources.items():
        target.write_text(source)
    print("Applied canonical prompt-history experiment; production is unchanged.")
