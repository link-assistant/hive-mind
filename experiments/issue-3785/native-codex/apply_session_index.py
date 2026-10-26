#!/usr/bin/env python3
"""Apply the Linux session-index experiment to exact, immutable native source.

The canonical index selector does not project full native history or install
anything in production. Real named-thread read/resume controls must pass too.
"""
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys

PIN = "6aaac694803004a63c6f393d153c96d22521a6b9"
INDEX_HASH = "921be45f67751fd25c2a893a88199a952f7fcf45b050983835a72da9bc1e13bc"
root = Path(sys.argv[1]).resolve(strict=True)
if subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() != PIN:
    raise SystemExit("Refusing unpinned native source.")
target = root / "codex-rs/rollout/src/session_index.rs"
source = target.read_text()
if hashlib.sha256(source.encode()).hexdigest() != INDEX_HASH:
    raise SystemExit("Refusing a changed native session index.")
module = target.with_name("canonical_session_index.rs")
tests = target.with_name("canonical_session_index_tests.rs")
if module.exists() or tests.exists():
    raise SystemExit("Refusing to overwrite an existing canonical index module.")


def replace(before, after):
    global source
    if source.count(before) != 1:
        raise SystemExit("Ambiguous pinned session index context; no files changed.")
    source = source.replace(before, after, 1)


replace("use std::fs::File;\n", "")
replace('const SESSION_INDEX_FILE: &str = "session_index.jsonl";', '''#[path = "canonical_session_index.rs"]
mod canonical_index;

const SESSION_INDEX_FILE: &str = "session_index.jsonl";''')
replace('''    with_session_index_lock(&SESSION_INDEX_LOCK, move || {
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;
        let mut line = serde_json::to_string(&entry).map_err(std::io::Error::other)?;
        line.push('\\n');
        file.write_all(line.as_bytes())?;
        file.flush()?;
        Ok(())
    })''', '''    with_session_index_lock(&SESSION_INDEX_LOCK, move || {
        canonical_index::with_index(&path, |path| {
            let mut file = canonical_index::open_append(path)?;
            let mut line = serde_json::to_string(&entry).map_err(std::io::Error::other)?;
            line.push('\\n');
            file.write_all(line.as_bytes())?;
            file.flush()?;
            if std::env::var_os("CODEX_SESSION_INDEX_HOME").is_some() { file.sync_all()?; }
            Ok(())
        })
    })''')
replace('''    with_session_index_lock(&SESSION_INDEX_LOCK, move || {
        let contents = match std::fs::read_to_string(&path) {''', '''    with_session_index_lock(&SESSION_INDEX_LOCK, move || {
        canonical_index::with_index(&path, |path| {
        let contents = match canonical_index::read_string(path) {''')
replace('''        let temp_path = path.with_extension("jsonl.tmp");
        std::fs::write(&temp_path, remaining)?;
        std::fs::rename(temp_path, path)
    })''', '''        canonical_index::replace(path, &remaining)
        })
    })''')
replace('''    if !path.exists() {
        return Ok(None);
    }
    let id = *thread_id;
    let entry = tokio::task::spawn_blocking(move || scan_index_from_end_by_id(&path, &id))''', '''    let id = *thread_id;
    let entry = tokio::task::spawn_blocking(move || {
        canonical_index::with_index(&path, |path| {
            if !canonical_index::exists(path)? { return Ok(None); }
            scan_index_from_end_by_id(path, &id)
        })
    })''')
replace('''    tokio::task::spawn_blocking(move || {
        if !path.exists() {
            return Ok(HashMap::new());
        }
        let mut scanner = ReverseJsonlScanner::new(File::open(path)?)?;''', '''    tokio::task::spawn_blocking(move || {
        canonical_index::with_index(&path, |path| {
        if !canonical_index::exists(path)? {
            return Ok(HashMap::new());
        }
        let mut scanner = ReverseJsonlScanner::new(canonical_index::open_read(path)?)?;''')
replace('''        Ok(names)
    })''', '''        Ok(names)
        })
    })''')
replace('''    if !path.exists() {
        return Ok(Vec::new());
    }
    let (tx, mut rx)''', '''    let (tx, mut rx)''')
replace('''    let scan =
        tokio::task::spawn_blocking(move || stream_thread_ids_from_end_by_name(&path, &name, tx));''', '''    let scan = tokio::task::spawn_blocking(move || {
        canonical_index::with_index(&path, |path| {
            if !canonical_index::exists(path)? { return Ok(()); }
            stream_thread_ids_from_end_by_name(path, &name, tx)
        })
    });''')
replace("ReverseJsonlScanner::new(File::open(path)?)?", "ReverseJsonlScanner::new(canonical_index::open_read(path)?)?")
source = subprocess.run(
    ["rustfmt", "--edition", "2024", "--config", "skip_children=true"],
    input=source, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
).stdout
if "--check" in sys.argv[2:]:
    print("Pinned canonical session index patch is applicable; no files changed.")
else:
    shutil.copyfile(Path(__file__).with_name("canonical_session_index.rs"), module)
    shutil.copyfile(Path(__file__).with_name("canonical_session_index_tests.rs"), tests)
    target.write_text(source)
    print("Applied canonical session index experiment; production is unchanged.")
