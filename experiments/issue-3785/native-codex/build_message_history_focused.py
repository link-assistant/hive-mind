#!/usr/bin/env python3
"""Low-memory unit harness; exact native history modules, two config type stubs.

This intentionally excludes the real configuration loader and its Starlark
dependency. Full native Cargo/CLI integration remains a separate required CI
check. Never substitute this harness for that integration evidence.
"""
from pathlib import Path
import os
import subprocess
import sys
import tomllib

root = Path(sys.argv[1]).resolve(strict=True)
output = Path(sys.argv[2]).absolute()
if subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() != "6aaac694803004a63c6f393d153c96d22521a6b9":
    raise SystemExit("Refusing unpinned native source.")
output.mkdir(mode=0o700, exist_ok=False)
shim = output / "config-types"
shim.mkdir(mode=0o700)
(shim / "Cargo.toml").write_text('''[package]
name = "codex-config"
version = "0.0.0"
edition = "2024"
[lib]
path = "types.rs"
''')
(shim / "types.rs").write_text('''// Only the two passive config value types are stubbed in this unit harness.
pub mod types {
    #[derive(Debug, Clone, Copy, PartialEq, Default)]
    pub enum HistoryPersistence { #[default] SaveAll, None }
    #[derive(Debug, Clone, PartialEq, Default)]
    pub struct History {
        pub persistence: HistoryPersistence,
        pub max_bytes: Option<usize>,
    }
}
''')
lock = tomllib.loads((root / "codex-rs/Cargo.lock").read_text())
versions = {item["name"]: item["version"] for item in lock["package"]}
source = root / "codex-rs/message-history/src"
probe = Path(__file__).with_name("message_history_probe.rs").resolve()
manifest = f'''[package]
name = "codex-message-history"
version = "0.0.0"
edition = "2024"
[lib]
name = "codex_message_history"
path = {str(source / "lib.rs")!r}
[[bin]]
name = "hive-message-history-probe"
path = {str(probe)!r}
[dependencies]
codex-config = {{ path = "config-types" }}
memchr = "={versions['memchr']}"
serde = {{ version = "={versions['serde']}", features = ["derive"] }}
serde_json = "={versions['serde_json']}"
tokio = {{ version = "={versions['tokio']}", features = ["fs", "io-util", "rt"] }}
tracing = {{ version = "={versions['tracing']}", features = ["log"] }}
[dev-dependencies]
pretty_assertions = "={versions['pretty_assertions']}"
tempfile = "={versions['tempfile']}"
tokio = {{ version = "={versions['tokio']}", features = ["macros", "rt-multi-thread"] }}
[profile.dev]
debug = 0
incremental = false
'''
(output / "Cargo.toml").write_text(manifest)
environment = {**os.environ, "CARGO_BUILD_JOBS": "1", "CARGO_INCREMENTAL": "0"}
subprocess.run([
    "prlimit", "--data=536870912", "--stack=16777216", "--core=0", "--",
    "cargo", "+1.99.1", "build", "--offline", "--manifest-path", str(output / "Cargo.toml"),
], env=environment, check=True)
print(f"Focused unit driver (configuration types stubbed): {output / 'target/debug/hive-message-history-probe'}")
if "--test" in sys.argv[3:]:
    subprocess.run([
        "prlimit", "--data=536870912", "--stack=16777216", "--core=0", "--",
        "cargo", "+1.99.1", "test", "--offline", "--manifest-path", str(output / "Cargo.toml"),
        "--lib", "--", "--test-threads=1",
    ], env=environment, check=True)
