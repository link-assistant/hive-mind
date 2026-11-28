"""Apply the canonical runtime changes to the pinned Codex 0.172.0 source."""

import hashlib
from pathlib import Path
import shutil
import subprocess
import sys


PIN = "3d86e43b075adeba2193ec5c22ac92f55afd82e6"
VERSION = "0.172.0"
INPUTS = Path(__file__).resolve().parent
PATCHES = ("auth", "history", "sqlite", "tui")
MODULES = {
    "core/src/config/canonical_sqlite_authority.rs": "canonical_sqlite_authority.rs",
    "core/src/config/canonical_sqlite_authority_tests.rs": "canonical_sqlite_authority_tests.rs",
    "login/src/auth/canonical_auth.rs": "canonical_auth.rs",
    "login/src/auth/canonical_refresh_intent.rs": "canonical_refresh_intent.rs",
    "login/src/auth/canonical_refresh_transaction.rs": "canonical_refresh_transaction.rs",
    "login/src/auth/canonical_transaction.rs": "canonical_transaction.rs",
    "message-history/src/canonical_message_history.rs": "canonical_message_history.rs",
    "rollout/src/canonical_rollout_maintenance.rs": "canonical_rollout_maintenance.rs",
    "rollout/src/canonical_session_index.rs": "canonical_session_index.rs",
    "rollout/src/canonical_session_index_tests.rs": "canonical_session_index_tests.rs",
    "state/build.rs": "canonical_sqlite_build.rs",
    "state/src/runtime/canonical_rollout_paths.rs": "canonical_rollout_paths.rs",
    "state/src/runtime/canonical_rollout_paths_tests.rs": "canonical_rollout_paths_tests.rs",
    "state/src/sqlite/canonical_sqlite_vfs.c": "canonical_sqlite_vfs.c",
    "state/src/sqlite/canonical_sqlite_vfs.rs": "canonical_sqlite_vfs.rs",
    "thread-store/src/local/rollout_migration/canonical_migration_journals.rs": "canonical_migration_journals.rs",
    "thread-store/src/local/rollout_migration/canonical_migration_journals_tests.rs": "canonical_migration_journals_tests.rs",
    "thread-store/src/local/rollout_migration/canonical_migration_stages.rs": "canonical_migration_stages.rs",
    "thread-store/src/local/rollout_migration/canonical_migration_stages_tests.rs": "canonical_migration_stages_tests.rs",
}
LOCK_BEFORE = "42a8f334ee469aeeb6fccda4bd468f5addbe6d4e564e2780a90473090112c5ab"
LOCK_AFTER = "eb74f10149aa3c96fc6db7ad8999fb7d6f7b37947bd8369cfadd05e6f9073ead"


def apply(root):
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    if commit != PIN:
        raise ValueError("This release port requires the pinned Codex 0.172.0 source.")
    rust = root / "codex-rs"
    lock = rust / "Cargo.lock"
    if hashlib.sha256(lock.read_bytes()).hexdigest() != LOCK_BEFORE:
        raise ValueError("Upstream Codex lockfile differs from the pinned input.")

    for target, source in MODULES.items():
        destination = rust / target
        if destination.exists() or destination.is_symlink():
            raise ValueError("Refusing to replace an upstream file with a canonical module.")
        shutil.copyfile(INPUTS / source, destination)
    patches = [str(INPUTS / f"release_0_172_{group}.patch") for group in PATCHES]
    subprocess.run(["git", "apply", "--check", *patches], cwd=root, check=True)
    subprocess.run(["git", "apply", *patches], cwd=root, check=True)

    # Upstream release tags leave workspace package versions at 0.0.0 in
    # Cargo.lock. Match the release manifest and include the existing VFS
    # build dependency, while leaving every third-party dependency pinned.
    state = 'name = "codex-state"\nversion = "0.0.0"\ndependencies = [\n "anyhow",'
    updated = lock.read_text().replace(state, state + '\n "cc",').replace('version = "0.0.0"', f'version = "{VERSION}"')
    if hashlib.sha256(updated.encode()).hexdigest() != LOCK_AFTER:
        raise ValueError("Could not reproduce the canonical Codex release lockfile.")
    lock.write_text(updated)


if __name__ == "__main__":
    apply(Path(sys.argv[1]).resolve())
