#!/usr/bin/env python3
"""Refuse unsafe native migration receipts before mutation; anchor their creation."""
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
modules = ['canonical_migration_journals.rs', 'canonical_migration_journals_tests.rs']
if any(publish.with_name(name).exists() for name in modules):
    raise SystemExit('Refusing to overwrite canonical migration journal modules.')
source, orchestration = originals
anchor = 'const MIGRATION_JOURNAL_DIRECTORY: &str = "rollout-migrations";'
if source.count(anchor) != 1:
    raise SystemExit('Refusing changed native migration module context.')
source = source.replace(anchor, '''#[path = "canonical_migration_journals.rs"]
pub(super) mod canonical_migration_journals;

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
        }
        let pending_published_migration''')
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
