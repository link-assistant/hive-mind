## Summary

When the CPU penalty monitor stops gracefully (SIGTERM/SIGINT) while a container is penalized, it lifts the cap and publishes `penalizedMs`. The published value does not include the time since the last tick, so `penalizedMs` goes **backwards**, often to `0`:

| Edition | `penalizedMs` 15 s after the cap (`$ --status`) | after the graceful stop |
| --- | --- | --- |
| JavaScript 0.37.6 | `15836` | `0` |
| Rust 0.25.4 | `15363` | `0` |

With the default 15-minute windows the monitor ticks every 30 s (`min(window) / 8`, clamped to 30 s), so up to ~30 s of every graceful-stop penalty is lost. A penalty that is lifted by a stop before its first post-apply tick reports `penaltyCount: 1, penalizedMs: 0`.

Found while verifying start-command for link-assistant/hive-mind#2801 (Docker CPU penalty; PR link-assistant/hive-mind#2802). Hive Mind reports how long a task was capped in its completion message, so it needs this counter to be right before it can switch from its own monitor to `$ --cpu-penalty`.

## Reproduction

Any Docker host. The script is [`experiments/issue-2801-start-command-penalized-ms-on-stop.sh`](https://github.com/link-assistant/hive-mind/blob/issue-2801-f9bf1f787e57/experiments/issue-2801-start-command-penalized-ms-on-stop.sh). It starts a busy container with `--cpu-penalty --cpu-penalty-trigger 20% --cpu-penalty-trigger-window 4m --cpu-penalty-release-window 4m`, waits for the 2-CPU cap, waits 15 s, sends SIGTERM to the monitor and polls `$ --status`:

```
$ START_BIN=$(which '$') experiments/issue-2801-start-command-penalized-ms-on-stop.sh
06:18:51 start-command version: 0.37.6; NCPU=6 WINDOW=4m STOP_AFTER=15s
06:23:16 capped: NanoCpus=2000000000 penalized limit=2 count=1 penalizedMs=484
06:23:32 before SIGTERM (15 s after the cap): penalized limit=2 count=1 penalizedMs=15836
06:23:33 cap lifted 1 s after SIGTERM: NanoCpus=6000000000
06:23:35 after graceful stop: monitor pids: '' observing limit=6 count=1 penalizedMs=0

$ START_BIN=~/.cargo/bin/start experiments/issue-2801-start-command-penalized-ms-on-stop.sh
06:18:51 start-command version: 0.25.4 (Rust); NCPU=6 WINDOW=4m STOP_AFTER=15s
06:23:16 capped: NanoCpus=2000000000 penalized limit=2 count=1 penalizedMs=167
06:23:31 before SIGTERM (15 s after the cap): penalized limit=2 count=1 penalizedMs=15363
06:23:46 cap lifted 15 s after SIGTERM: NanoCpus=6000000000
06:23:48 after graceful stop: monitor pids: '' observing limit=6 count=1 penalizedMs=0
```

## Root cause

`penalizedMs` is only advanced inside `evaluate()`, by `now - lastAt` (`js/src/lib/cpu-penalty.js:138`, `rust/src/lib/cpu_penalty.rs:237`). While the phase is `penalized`, `$ --status` extrapolates it from `updatedAt` (`js/src/lib/cpu-penalty-monitor.js:36`, `read_state` in `rust/src/lib/cpu_penalty_monitor.rs`), which is why the status before the stop shows ~15.8 s.

The graceful-stop path (`js/src/lib/cpu-penalty-monitor.js:292-299`, `rust/src/lib/cpu_penalty_monitor.rs:312-321`) switches the phase to `observing` and publishes, but does not first add `now - lastAt`. Once the phase is `observing`, `$ --status` no longer extrapolates, so the time since the last tick is lost for good.

## Expected

Before the graceful-stop lift publishes `observing`, add the elapsed penalized time:

```js
const now = Date.now();
state = { ...state, penalizedMs: state.penalizedMs + Math.max(0, now - state.lastAt), lastAt: now, phase: 'observing', limitCpus: cpus, since: now };
```

```rust
let now = Utc::now().timestamp_millis();
state.penalized_ms += (now - state.last_at).max(0) as u64;
state.last_at = now;
```

A unit test should check that `penalizedMs` after a graceful stop is at least its last `$ --status` value, i.e. it never decreases.
