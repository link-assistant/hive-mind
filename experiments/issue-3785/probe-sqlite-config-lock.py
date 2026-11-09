#!/usr/bin/env python3
"""Verify actual configuration admission does not release another SQLite lock."""
import argparse
import errno
import fcntl
import json
import os
from pathlib import Path
import resource
import selectors
import subprocess
import tempfile


def limits(data_mib=128):
    resource.setrlimit(resource.RLIMIT_DATA, (data_mib * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_STACK, (8 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def compiler_limits():
    limits(384)


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("source", type=Path, help="Actual original or prepared canonical_sqlite_authority.rs")
parser.add_argument("--expect-lock-lost", action="store_true")
parser.add_argument("--sqlite-include", required=True, type=Path,
                    help="Checked pinned SQLite header directory; lock control uses no SQLite data I/O")
args = parser.parse_args()
assert args.source.is_absolute() and args.source.stat().st_size <= 32768
experiment = Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix="sqlite-config-lock-") as temporary:
    root = Path(temporary)
    selected, private = root / "selected", root / "private"
    for path in (selected, private):
        path.mkdir(mode=0o700)
    database = selected / "state_5.sqlite"
    database.touch(mode=0o600)
    helper = root / "helper.o"
    subprocess.run(["cc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-c",
                    str(experiment / "probe-sqlite-config-lock.c"), "-o", str(helper)],
                   check=True, capture_output=True, timeout=30, preexec_fn=limits)
    vfs = root / "vfs.o"
    subprocess.run(["cc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-c",
                    "-I", str(args.sqlite_include),
                    str(experiment / "native-codex/canonical_sqlite_vfs.c"), "-o", str(vfs)],
                   check=True, capture_output=True, timeout=30, preexec_fn=limits)
    source = root / "probe.rs"
    source.write_text('''
extern crate self as codex_state;
use std::io::{Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;
#[path = ''' + json.dumps(str(args.source)) + '''] mod canonical;
unsafe extern "C" {
    fn synthetic_database_lock(descriptor: i32) -> i32;
    fn hive_canonical_sqlite_vfs(root: *const std::ffi::c_char) -> i32;
}
pub fn admit_canonical_sqlite(root: &Path) -> std::io::Result<()> {
    let root = std::ffi::CString::new(root.as_os_str().as_bytes()).unwrap();
    assert_eq!(unsafe { hive_canonical_sqlite_vfs(root.as_ptr()) }, 0);
    Ok(())
}
fn main() {
    let args = std::env::args().collect::<Vec<_>>();
    let root = Path::new(&args[1]);
    let private = Path::new(&args[2]);
    let database = std::fs::OpenOptions::new().read(true).write(true)
        .open(root.join("state_5.sqlite")).unwrap();
    assert_eq!(unsafe { synthetic_database_lock(database.as_raw_fd()) }, 0);
    canonical::admit(root, root, private).unwrap();
    println!("READY");
    std::io::stdout().flush().unwrap();
    let mut signal = [0];
    std::io::stdin().read_exact(&mut signal).unwrap();
    assert_eq!(signal, [b'\\n']);
    drop(database);
}
''')
    binary = root / "probe"
    subprocess.run(["rustc", "--edition", "2024", "-C", "debuginfo=0", str(source),
                    "-C", "link-arg=" + str(helper), "-C", "link-arg=" + str(vfs),
                    "-l", "sqlite3", "-l", "pthread", "-o", str(binary)],
                   check=True, capture_output=True, timeout=30, preexec_fn=compiler_limits)
    environment = dict(os.environ, CODEX_SQLITE_HOME=str(selected), CODEX_ROLLOUT_HOME=str(selected))
    child = subprocess.Popen([str(binary), str(selected), str(private)], env=environment,
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             text=True, preexec_fn=limits)
    try:
        with selectors.DefaultSelector() as ready:
            ready.register(child.stdout, selectors.EVENT_READ)
            assert ready.select(timeout=5), "Configuration lock probe did not become ready"
        first = child.stdout.readline(1024)
        if first != "READY\n":
            output, error = child.communicate(timeout=5)
            raise AssertionError((first, child.returncode, error[:4096]))
        lost = False
        with database.open("r+b") as observer:
            try:
                fcntl.lockf(observer, fcntl.LOCK_EX | fcntl.LOCK_NB, 1)
                lost = True
            except OSError as error:
                assert error.errno in (errno.EACCES, errno.EAGAIN)
        output, error = child.communicate("\n", timeout=5)
        assert child.returncode == 0 and len(output) + len(error) < 8192, (output, error)
        print(json.dumps({"configurationReleasedExistingPosixLock": lost,
                          "expectedLockLoss": args.expect_lock_lost}), flush=True)
        assert lost == args.expect_lock_lost, "Configuration admission changed another database descriptor's POSIX lock."
    finally:
        if child.poll() is None:
            child.kill()
        child.communicate(timeout=5)
