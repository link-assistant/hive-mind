#!/usr/bin/env python3
"""Test the exact native init function with a finite failing-runtime fixture."""
import argparse
import fcntl
import os
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("source_root", type=Path)
parser.add_argument("--expect-fallback", action="store_true")
args = parser.parse_args()
root = args.source_root.resolve(strict=True)
source = (root / "codex-rs/rollout/src/state_db.rs").read_text()
start = "pub async fn init(config: &impl RolloutConfigView) -> Option<StateDbHandle> {"
end = "/// Initialize the state runtime and return any initialization error to the caller."
assert source.count(start) == source.count(end) == 1
native_init = start + source.split(start)[1].split(end)[0]
fixtures = r'''
use std::future::Future;
use std::task::{Context, Poll, Waker};
pub trait RolloutConfigView {}
struct Config;
impl RolloutConfigView for Config {}
pub type StateDbHandle = ();
struct RolloutConfig { codex_home: (), sqlite: (), model_provider_id: () }
impl RolloutConfig {
    fn from_view(_: &impl RolloutConfigView) -> Self {
        Self { codex_home: (), sqlite: (), model_provider_id: () }
    }
}
async fn try_init_with_roots(_: (), _: (), _: ()) -> Result<(), &'static str> {
    if std::env::args().nth(1).as_deref() == Some("healthy") { Ok(()) }
    else { Err("Synthetic failed runtime details must not enter selected diagnostics.") }
}
fn emit_startup_warning(_: &str) { eprintln!("LEGACY_WARNING"); }
// The fixture replaces only the libc declarations and runtime constructor.
// These calls exercise the real Linux stderr descriptor and process exit.
mod libc {
    pub const STDERR_FILENO: i32 = 2;
    pub const F_GETFL: i32 = 3;
    pub const F_SETFL: i32 = 4;
    pub const O_NONBLOCK: i32 = 0x800;
    unsafe extern "C" {
        pub fn fcntl(fd: i32, operation: i32, ...) -> i32;
        pub fn write(fd: i32, bytes: *const std::ffi::c_void, count: usize) -> isize;
        pub fn _exit(status: i32) -> !;
    }
}
fn main() {
    let mut future = Box::pin(init(&Config));
    let mut context = Context::from_waker(Waker::noop());
    let Poll::Ready(state) = future.as_mut().poll(&mut context) else { panic!("Finite fixture"); };
    println!("RESULT state={}", state.is_some());
}
'''
with tempfile.TemporaryDirectory(prefix="native-sqlite-startup-tests-") as temporary:
    harness, binary = Path(temporary) / "harness.rs", Path(temporary) / "startup"
    harness.write_text(fixtures + native_init)
    subprocess.run(["prlimit", "--data=268435456", "--stack=16777216", "--core=0", "--",
                    "rustc", "+1.99.1", "--edition", "2024", "-A", "dead_code",
                    str(harness), "-o", str(binary)], check=True)
    command = ["prlimit", "--data=134217728", "--stack=8388608", "--core=0", "--", str(binary)]
    for selected, healthy in ((False, True), (True, True), (False, False), (True, False)):
        env = dict(os.environ)
        env.pop("CODEX_ROLLOUT_HOME", None)
        if selected:
            env["CODEX_ROLLOUT_HOME"] = "/synthetic/canonical"
        result = subprocess.run(command + (["healthy"] if healthy else []), env=env,
                                capture_output=True, timeout=3)
        refuse = selected and not healthy and not args.expect_fallback
        assert result.returncode == (78 if refuse else 0), "Selected startup error must refuse."
        expected_output = b"" if refuse else f"RESULT state={str(healthy).lower()}\n".encode()
        expected_error = (b"Canonical SQLite startup failed; no turn was sent.\n" if refuse else
                          b"" if healthy else b"LEGACY_WARNING\n")
        assert result.stdout == expected_output and result.stderr == expected_error
        print(f"PASS actualNativeInit selected={selected} healthy={healthy} refused={refuse}", flush=True)
    if not args.expect_fallback:
        read_fd, write_fd = os.pipe()
        try:
            original = fcntl.fcntl(write_fd, fcntl.F_GETFL)
            fcntl.fcntl(write_fd, fcntl.F_SETFL, original | os.O_NONBLOCK)
            total = 0
            while total < 1024 * 1024:
                try:
                    total += os.write(write_fd, b"x" * 4096)
                except BlockingIOError:
                    break
            assert 0 < total < 1024 * 1024, "The diagnostic fixture must reach a finite full pipe."
            fcntl.fcntl(write_fd, fcntl.F_SETFL, original)
            result = subprocess.run(command, env=env, stdout=subprocess.PIPE, stderr=write_fd, timeout=3)
            assert result.returncode == 78 and result.stdout == b""
            print("PASS actualNativeInit fullDiagnosticPipe=1 refused=1", flush=True)
        finally:
            os.close(write_fd)
            os.close(read_fd)

        def close_stderr():
            os.close(2)

        result = subprocess.run(command, env=env, stdout=subprocess.PIPE, preexec_fn=close_stderr, timeout=3)
        assert result.returncode == 78 and result.stdout == b""
        print("PASS actualNativeInit missingDiagnosticDescriptor=1 refused=1", flush=True)
