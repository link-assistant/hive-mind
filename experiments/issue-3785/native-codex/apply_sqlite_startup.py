#!/usr/bin/env python3
"""Refuse native execution after selected SQLite startup fails."""
import hashlib
from pathlib import Path
import subprocess
import sys

root = Path(sys.argv[1]).resolve(strict=True)
if subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip() != '6aaac694803004a63c6f393d153c96d22521a6b9':
    raise SystemExit('Refusing unpinned native source.')
target = root / 'codex-rs/rollout/src/state_db.rs'
source = target.read_text()
if hashlib.sha256(source.encode()).hexdigest() != '22bb1352fffb26b1ca2e2183a7521b7aa1bc458d4fa8054dfa94f385c91a6ad5':
    raise SystemExit('Refusing changed native SQLite startup policy.')
anchor = '''        Err(err) => {
            emit_startup_warning(&format!("failed to initialize state runtime: {err:#}"));
            None
        }
'''
replacement = '''        Err(err) => {
            #[cfg(target_os = "linux")]
            if std::env::var_os("CODEX_ROLLOUT_HOME").is_some() {
                // An optional-runtime fallback loses selected canonical state.
                // Refuse without checkpoints, atexit writers or sensitive error
                // details. A full diagnostic pipe must not delay refusal.
                const MESSAGE: &[u8] = b"Canonical SQLite startup failed; no turn was sent.\\n";
                // SAFETY: the constant message outlives this bounded write. The
                // process exits immediately; no borrowed native state returns.
                unsafe {
                    let flags = libc::fcntl(libc::STDERR_FILENO, libc::F_GETFL);
                    if flags >= 0 && libc::fcntl(libc::STDERR_FILENO, libc::F_SETFL,
                                                 flags | libc::O_NONBLOCK) == 0 {
                        let _ = libc::write(libc::STDERR_FILENO, MESSAGE.as_ptr().cast(), MESSAGE.len());
                    }
                    libc::_exit(78);
                }
            }
            emit_startup_warning(&format!("failed to initialize state runtime: {err:#}"));
            None
        }
'''
if source.count(anchor) != 1:
    raise SystemExit('Refusing changed native SQLite fallback context.')
source = subprocess.run(
    ['rustfmt', '--edition', '2024', '--config', 'skip_children=true'],
    input=source.replace(anchor, replacement, 1), text=True,
    capture_output=True, check=True,
).stdout
if '--check' in sys.argv[2:]:
    print('Pinned native SQLite startup refusal is applicable; no files changed.')
else:
    target.write_text(source)
    print('Selected native SQLite startup errors refuse execution; ordinary fallback is preserved.')
