#!/usr/bin/env python3
"""Project native maintenance ownership without sharing the task's .tmp tree."""
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(sys.argv[1]).resolve(strict=True)
if subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() != "6aaac694803004a63c6f393d153c96d22521a6b9":
    raise SystemExit("Refusing unpinned native source.")
target = root / "codex-rs/rollout/src/maintenance.rs"
source = target.read_text()
if hashlib.sha256(source.encode()).hexdigest() != "abdbd690732aaee671609fc0540c9e845a15116c0de183b0dd976d560f55c404":
    raise SystemExit("Refusing changed native maintenance source.")
module = target.with_name("canonical_rollout_maintenance.rs")
if module.exists():
    raise SystemExit("Refusing to overwrite a native maintenance module.")


def replace(before, after):
    global source
    if source.count(before) != 1:
        raise SystemExit("Ambiguous native maintenance context; no files changed.")
    source = source.replace(before, after, 1)


replace('const ROLLOUT_MAINTENANCE_LOCK:', '''#[path = "canonical_rollout_maintenance.rs"]
mod canonical_maintenance;

const ROLLOUT_MAINTENANCE_LOCK:''')
replace('''    _file: File,
}''', '''    _file: File,
    _canonical_directory: Option<File>,
}''')
replace('''    let directory = codex_home.join(".tmp");''', '''    if let Some(root) = std::env::var_os("CODEX_ROLLOUT_MAINTENANCE_HOME") {
        return canonical_maintenance::try_acquire(codex_home, Path::new(&root)).map(|guard| {
            guard.map(|(file, directory)| RolloutMaintenanceGuard {
                _file: file,
                _canonical_directory: Some(directory),
            })
        });
    }
    let directory = codex_home.join(".tmp");''')
replace('''Ok(Some(RolloutMaintenanceGuard { _file: file }))''', '''Ok(Some(RolloutMaintenanceGuard {
            _file: file,
            _canonical_directory: None,
        }))''')
source = subprocess.run(
    ["rustfmt", "--edition", "2024", "--config", "skip_children=true"],
    input=source, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True,
).stdout
if "--check" in sys.argv[2:]:
    print("Pinned canonical maintenance patch is applicable; no files changed.")
else:
    shutil.copyfile(Path(__file__).with_name(module.name), module)
    target.write_text(source)
    print("Applied canonical maintenance experiment; production is unchanged.")
