## Summary

On SIGTERM/SIGINT the **Rust** CPU penalty monitor waits out its current tick sleep before it lifts the cap. With the default 15-minute windows the tick is 30 s, so a graceful stop takes **up to ~30 s** to restore the CPUs. The JavaScript monitor wakes up at once and lifts the cap in about 1 s.

| Edition           | cap lifted after SIGTERM       |
| ----------------- | ------------------------------ |
| JavaScript 0.37.6 | 1 s                            |
| Rust 0.25.4       | 15 s (the rest of a 30 s tick) |

The supervising shell (`supervise_snippet`) forwards the TERM to the monitor and then `wait`s for it, so the whole watcher also takes that long to exit. If whatever stops the watcher gives it less time than that (e.g. `docker stop`'s default 10 s grace for a supervisor that runs in a container), the monitor is SIGKILLed before the lift. The container then stays capped until `$ --resume-all` starts a new monitor and it lifts the cap one release window later (the #206 recovery path). The graceful-stop restore added for #206 is not reliable in the Rust edition.

Found while verifying start-command for link-assistant/hive-mind#2801 (Docker CPU penalty; PR link-assistant/hive-mind#2802).

## Reproduction

Any Docker host, `cargo install start-command --version 0.25.4`, then [`experiments/issue-2801-start-command-penalized-ms-on-stop.sh`](https://github.com/link-assistant/hive-mind/blob/issue-2801-f9bf1f787e57/experiments/issue-2801-start-command-penalized-ms-on-stop.sh) (4-minute windows, so a 30 s tick; SIGTERM 15 s after the cap):

```
$ START_BIN=~/.cargo/bin/start experiments/issue-2801-start-command-penalized-ms-on-stop.sh
06:18:51 start-command version: 0.25.4 (Rust); NCPU=6 WINDOW=4m STOP_AFTER=15s
06:23:16 capped: NanoCpus=2000000000 penalized limit=2 count=1 penalizedMs=167
06:23:31 before SIGTERM (15 s after the cap): penalized limit=2 count=1 penalizedMs=15363
06:23:46 cap lifted 15 s after SIGTERM: NanoCpus=6000000000

$ START_BIN=$(which '$') experiments/issue-2801-start-command-penalized-ms-on-stop.sh
06:23:32 before SIGTERM (15 s after the cap): penalized limit=2 count=1 penalizedMs=15836
06:23:33 cap lifted 1 s after SIGTERM: NanoCpus=6000000000
```

With 20 s windows (2.5 s tick) the Rust edition lifts quickly, which is why the short-window e2e checks pass.

## Root cause

`rust/src/lib/cpu_penalty_monitor.rs`:

```rust
while !STOP.load(Ordering::Relaxed) {
    // tick ...
    thread::sleep(Duration::from_millis(interval as u64));   // line 259
}
```

The signal handler only sets `STOP`. `std::thread::sleep` restarts `nanosleep` with the remaining time after `EINTR`, so the loop does not see `STOP` until the full interval has passed. The JavaScript monitor sleeps on a promise that `stop()` resolves through `wake()` (`js/src/lib/cpu-penalty-monitor.js:139-142, 252-257`).

## Expected

Lift the cap within about a second of SIGTERM/SIGINT, as the JavaScript edition does. For example, sleep in short slices (`while slept < interval && !STOP { sleep(min(250 ms, rest)) }`), or wait on a `Condvar` / self-pipe that the handler signals. A test should send SIGTERM to a penalized monitor that has a long tick interval and assert that the cap is lifted well before the interval ends.
