#!/usr/bin/env python3
"""Build only the actual pinned SQLx/C adapter control with bounded compiler memory."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("output", type=Path)
parser.add_argument("--cargo-lock", required=True, type=Path)
parser.add_argument("--online", action="store_true", help="Fetch missing dependencies through Cargo before compiling")
args = parser.parse_args()
assert args.output.is_absolute() and not args.output.exists()
root = args.output
root.mkdir(mode=0o700)
(root / "src/sqlite").mkdir(parents=True)
adapters = Path(__file__).resolve().parent / "native-codex"
for name, target in (
    ("canonical_sqlite_control.rs", "src/main.rs"),
    ("canonical_sqlite_vfs.rs", "src/canonical_sqlite_vfs.rs"),
    ("canonical_sqlite_vfs.c", "src/sqlite/canonical_sqlite_vfs.c"),
    ("canonical_sqlite_build.rs", "build.rs"),
):
    shutil.copyfile(adapters / name, root / target)
(root / "Cargo.toml").write_text('''[package]
name = "codex-sqlite-vfs-control"
version = "0.0.0"
edition = "2024"
[dependencies]
libsqlite3-sys = { version = "=0.37.0", default-features = false }
sqlx = { version = "=0.9.0", default-features = false, features = ["runtime-tokio", "sqlite-bundled"] }
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
[build-dependencies]
cc = "=1.2.55"
''')
shutil.copyfile(args.cargo_lock, root / "Cargo.lock")
environment = dict(os.environ, CARGO_BUILD_JOBS="1", CARGO_INCREMENTAL="0",
                   CARGO_PROFILE_DEV_DEBUG="0", CARGO_PROFILE_DEV_OPT_LEVEL="0",
                   CARGO_PROFILE_DEV_CODEGEN_UNITS="256", LIBSQLITE3_FLAGS="SQLITE_ENABLE_FILESTAT")
# One compiler at a time, each bounded to 512 MiB data and 16 MiB stack. This
# intentionally builds no Codex workspace or CLI. Preserve Cargo's full log.
subprocess.run(["prlimit", "--data=536870912", "--stack=16777216", "--core=0", "--",
                "cargo", "build", *([] if args.online else ["--offline"]), "-j", "1"],
               cwd=root, env=environment, check=True)
print("Built the bounded actual-SQLx control; this is not a compiled Codex acceptance result.")
