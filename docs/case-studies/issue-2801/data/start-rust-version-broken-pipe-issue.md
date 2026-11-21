## Summary

The Rust edition (`cargo install start-command`, checked on 0.25.4 and 0.25.6) panics when stdout is closed before it finishes printing, for example `start --version | head -1`. It exits with code 101 and prints a panic message to stderr. The JS edition (npm 0.37.7) exits 0 in the same pipeline.

## Reproduce

```sh
cargo install start-command --version 0.25.6 --root /tmp/sc
/tmp/sc/bin/start --version | head -1; echo "exit=${PIPESTATUS[0]}"
/tmp/sc/bin/start --version | true;    echo "exit=${PIPESTATUS[0]}"
```

Output:

```
start-command version: 0.25.6 (Rust)

thread 'main' (70117) panicked at /rustc/b940084d7eb6a299eb4bfeb8e34901bc051e7ac4/library/std/src/io/stdio.rs:1168:9:
failed printing to stdout: Broken pipe (os error 32)
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
exit=101
```

The JS edition for comparison:

```
$ $ --version | head -1; echo "exit=${PIPESTATUS[0]}"
start-command version: 0.37.7
exit=0
```

`start --help | head -1` exits 0, so the panic seems to come from the multi-line `--version` output (the blank line and the `OS:`/`Shell:` lines are written after `head` has closed the pipe).

## Root cause

Rust ignores `SIGPIPE` by default, so a write to a closed pipe returns `EPIPE`, and `println!` panics on any write error (`library/std/src/io/stdio.rs`, "failed printing to stdout").

## Possible fixes

- Write with `writeln!(io::stdout().lock(), …)` and treat `ErrorKind::BrokenPipe` as a normal exit (code 0), as the JS edition already does.
- Or restore the default `SIGPIPE` action at the start of `main` (`libc::signal(libc::SIGPIPE, libc::SIG_DFL)`), the usual approach for Unix CLI filters.

A regression test can run the binary with its stdout read for one line and then closed, and assert that the exit status is not 101 and that stderr has no `panicked`.

## Context

Found while checking `--cpu-penalty` for link-assistant/hive-mind#2801 (case study: `docs/case-studies/issue-2801/`). It does not affect the CPU penalty. It shows up at the top of every Rust verification log there, because the scripts run `start --version | head -1`.
