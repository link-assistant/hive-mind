#!/usr/bin/env python3
"""Anchor selected native migration receipts, staging, publication and cleanup."""
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys


root = Path(sys.argv[1]).resolve(strict=True)
if subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip() != '6aaac694803004a63c6f393d153c96d22521a6b9':
    raise SystemExit('Refusing unpinned native source.')
publish = root / 'codex-rs/thread-store/src/local/rollout_migration/publish.rs'
orchestrator = publish.parent.with_suffix('.rs')
originals = [publish.read_text(), orchestrator.read_text()]
hashes = ['256f897ca325b67197d8d63231e88b433db93341f69aa5e6cb9140f532339666',
          '30de1a041b1e32af8c24cc0ced39f4365b3ad339945c9473fc7ca755232531d2']
for target, source, expected in zip([publish, orchestrator], originals, hashes):
    if hashlib.sha256(source.encode()).hexdigest() != expected:
        raise SystemExit('Refusing changed native migration journal contexts.')
modules = ['canonical_migration_journals.rs', 'canonical_migration_journals_tests.rs',
           'canonical_migration_stages.rs', 'canonical_migration_stages_tests.rs']
if any(publish.with_name(name).exists() for name in modules):
    raise SystemExit('Refusing to overwrite canonical migration journal modules.')
source, orchestration = originals
anchor = 'const MIGRATION_JOURNAL_DIRECTORY: &str = "rollout-migrations";'
if source.count(anchor) != 1:
    raise SystemExit('Refusing changed native migration module context.')
source = source.replace(anchor, '''#[path = "canonical_migration_journals.rs"]
pub(super) mod canonical_migration_journals;
#[path = "canonical_migration_stages.rs"]
pub(super) mod canonical_migration_stages;

''' + anchor)
anchor = 'pub(super) async fn write_migration_journal(path: &Path) -> ThreadStoreResult<()> {\n'
if source.count(anchor) != 1:
    raise SystemExit('Refusing changed native migration writer context.')
source = source.replace(anchor, anchor + '''    if std::env::var_os("CODEX_ROLLOUT_HOME").is_some() {
        let path = path.to_path_buf();
        return tokio::task::spawn_blocking(move || canonical_migration_journals::write(&path))
            .await
            .map_err(migration_error)?
            .map_err(migration_error);
    }
''')
anchor = '''        let journal_path = migration_journal_path(&self.config.codex_home, thread_id);
        let pending_published_migration'''
if orchestration.count(anchor) != 1:
    raise SystemExit('Refusing changed native migration admission context.')
orchestration = orchestration.replace(anchor, '''        let journal_path = migration_journal_path(&self.config.codex_home, thread_id);
        if options.mode == RolloutMigrationMode::Apply {
            publish::canonical_migration_journals::validate(&journal_path)
                .map_err(migration_error)?;
            publish::canonical_migration_stages::validate_rollout(&path)
                .map_err(migration_error)?;
        }
        let pending_published_migration''')


def replace_once(value, old, new, count=1):
    if value.count(old) != count:
        raise SystemExit('Refusing changed native staging or cleanup context.')
    return value.replace(old, new)


# Async wrappers retain the original native behavior without the selector.
# The selected branches perform blocking filesystem work on held descriptors.
source = replace_once(source, 'pub(super) async fn remove_file_if_present(path: &Path) -> ThreadStoreResult<()> {\n', '''pub(super) async fn create_staged_file(path: &Path) -> ThreadStoreResult<File> {
    if std::env::var_os("CODEX_ROLLOUT_HOME").is_some() {
        let path = path.to_path_buf();
        return tokio::task::spawn_blocking(move || canonical_migration_stages::open_write(&path))
            .await.map_err(migration_error)?.map(File::from_std).map_err(migration_error);
    }
    tokio::fs::OpenOptions::new().create(true).truncate(true).write(true)
        .open(path).await.map_err(migration_error)
}

pub(super) async fn open_migration_file(path: &Path) -> ThreadStoreResult<File> {
    if std::env::var_os("CODEX_ROLLOUT_HOME").is_some() {
        let path = path.to_path_buf();
        return tokio::task::spawn_blocking(move || canonical_migration_stages::open_existing(&path, false))
            .await.map_err(migration_error)?.map(File::from_std).map_err(migration_error);
    }
    File::open(path).await.map_err(migration_error)
}

pub(super) async fn publish_staged_file(source: &Path, target: &Path) -> ThreadStoreResult<()> {
    if std::env::var_os("CODEX_ROLLOUT_HOME").is_some() {
        let source = source.to_path_buf();
        let target = target.to_path_buf();
        return tokio::task::spawn_blocking(move || canonical_migration_stages::publish(&source, &target))
            .await.map_err(migration_error)?.map_err(migration_error);
    }
    tokio::fs::rename(source, target).await.map_err(migration_error)
}

pub(super) async fn remove_file_if_present(path: &Path) -> ThreadStoreResult<()> {
    if std::env::var_os("CODEX_ROLLOUT_HOME").is_some() {
        let path = path.to_path_buf();
        return tokio::task::spawn_blocking(move || {
            if path.parent().and_then(Path::file_name).is_some_and(|name| name == "rollout-migrations") {
                canonical_migration_journals::remove(&path, false)
            } else {
                canonical_migration_stages::remove(&path)
            }
        }).await.map_err(migration_error)?.map_err(migration_error);
    }
''')
source = replace_once(source, 'let mut output = options.open(plain_path)?;', '''let mut output = if std::env::var_os("CODEX_ROLLOUT_HOME").is_some() {
            canonical_migration_stages::open_write(&plain_path)?
        } else { options.open(plain_path)? };''')
source = replace_once(source, '''let output = std::fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&compressed_path)?;''', '''let output = if std::env::var_os("CODEX_ROLLOUT_HOME").is_some() {
            canonical_migration_stages::open_write(&compressed_path)?
        } else {
            std::fs::OpenOptions::new().create(true).truncate(true).write(true).open(&compressed_path)?
        };''')
for variable in ['compressed_path', 'plain_path']:
    old = f'std::fs::File::open({variable})?'
    source = replace_once(source, old, f'''if std::env::var_os("CODEX_ROLLOUT_HOME").is_some() {{
            canonical_migration_stages::open_existing(&{variable}, false)?
        }} else {{ {old} }}''', count=2 if variable == 'compressed_path' else 1)
source = replace_once(source, 'File::open(staged_path).await.map_err(migration_error)?', 'open_migration_file(staged_path).await?')
source = replace_once(source, '''tokio::fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&rewritten_path)
        .await
        .map_err(migration_error)?''', 'create_staged_file(&rewritten_path).await?')
source = replace_once(source, '''tokio::fs::rename(rewritten_path, staged_path)
        .await
        .map_err(migration_error)''', 'publish_staged_file(&rewritten_path, staged_path).await')
orchestration = replace_once(orchestration, '''tokio::fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(input.staged_path)
            .await
            .map_err(migration_error)?''', 'publish::create_staged_file(input.staged_path).await?', count=2)
orchestration = replace_once(orchestration, 'File::open(source_path).await.map_err(migration_error)', 'publish::open_migration_file(source_path).await', count=2)
orchestration = replace_once(orchestration, 'File::open(rollout_path).await.map_err(migration_error)?', 'publish::open_migration_file(rollout_path).await?')
orchestration = replace_once(orchestration, '''File::open(input.source_path)
            .await
            .map_err(migration_error)?''', 'publish::open_migration_file(input.source_path).await?')
orchestration = replace_once(orchestration, 'let file = std::fs::OpenOptions::new().write(true).open(path)?;', '''let file = if std::env::var_os("CODEX_ROLLOUT_HOME").is_some() {
                    publish::canonical_migration_stages::open_existing(&path, true)?
                } else { std::fs::OpenOptions::new().write(true).open(path)? };''')
for variable in ['compressed_staged_path', '&staged_path']:
    orchestration = replace_once(orchestration, f'''tokio::fs::rename({variable}, rollout_path)
                    .await
                    .map_err(migration_error)?;''', f'publish::publish_staged_file(&{variable.lstrip("&")}, rollout_path).await?;')
orchestration = replace_once(orchestration, '''tokio::fs::remove_file(journal_path)
            .await
            .map_err(migration_error)?;''', '''if std::env::var_os("CODEX_ROLLOUT_HOME").is_some() {
            let path = journal_path.to_path_buf();
            tokio::task::spawn_blocking(move || publish::canonical_migration_journals::remove(&path, true))
                .await.map_err(migration_error)?.map_err(migration_error)?;
        } else {
            tokio::fs::remove_file(journal_path).await.map_err(migration_error)?;
        }''')
formatted = []
for value in [source, orchestration]:
    formatted.append(subprocess.run(
        ['rustfmt', '--edition', '2024', '--config', 'skip_children=true'],
        input=value, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
    ).stdout)
if '--check' in sys.argv[2:]:
    print('Pinned canonical migration journal patch is applicable; no files changed.')
else:
    for name in modules:
        shutil.copyfile(Path(__file__).with_name(name), publish.with_name(name))
    for target, value in zip([publish, orchestrator], formatted):
        target.write_text(value)
    print('Applied canonical migration journal experiment; production is unchanged.')
