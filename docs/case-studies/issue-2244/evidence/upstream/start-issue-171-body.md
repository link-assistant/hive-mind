## Summary

When a detached Docker container exits non-zero, start-command deliberately keeps it "for investigation" and writes that decision into the session log:

```
Container kept for investigation: 04d07ec8-1e0e-4866-b7a3-cea8049552c3
Reason: exitCode=137 oomKilled=false
```

But the log — the **only artifact that outlives the container** — never records *what actually happened to the container*. It does not name the signal, it does not carry `StartedAt`/`FinishedAt`, and it does not carry the `State` snapshot. All of that is available to the completion watcher at the moment it writes those lines, and `exitReason "signal (SIGKILL)"` is even computed by `$ --status` — but only in memory, at query time, and only while the record can still be enriched.

The result is that "kept for investigation" preserves a container that the host will eventually reap, and a log that cannot answer the first question of the investigation: *was it killed, and by what?*

Reproduced on **start-command 0.33.0** (latest on npm), Node v26.3.0, Linux, Docker isolation.

## Reproduction

```bash
session="$(cat /proc/sys/kernel/random/uuid)"
$ --isolated docker --image alpine:3.20 --shell sh \
  --detached --session "$session" -- 'sleep 300' | tee /tmp/launch.log

log_path="$(grep -o '/tmp/start-command/logs/isolation/docker/[^ ]*\.log' /tmp/launch.log | head -n1)"

sleep 5
docker kill --signal KILL "$session"       # exit 137, not an OOM
sleep 3                                     # let the completion watcher finish

echo "--- what the log knows ---"
tail -n 12 "$log_path"
grep -ci 'signal\|sigkill' "$log_path"     # => 0

echo "--- what Docker knew at that moment ---"
docker inspect -f '{{.State.StartedAt}} {{.State.FinishedAt}} {{.State.ExitCode}} {{.State.OOMKilled}}' "$session"

echo "--- what --status can still compute, but never wrote down ---"
$ --status "$session" | grep -E 'exitReason|exitCode'
```

## Observed

Log tail (complete, nothing omitted):

```
Container kept for investigation: 04d07ec8-1e0e-4866-b7a3-cea8049552c3
Reason: exitCode=137 oomKilled=false
Re-enter while running: $ --attach 04d07ec8-1e0e-4866-b7a3-cea8049552c3
Continue the stored command: $ --resume 04d07ec8-1e0e-4866-b7a3-cea8049552c3
Run another command in the same container: $ --resume 04d07ec8-1e0e-4866-b7a3-cea8049552c3 -- <command>
Remove when done: docker rm -f 04d07ec8-1e0e-4866-b7a3-cea8049552c3

==================================================
Finished: 2026-09-15 22:21:47.014
Exit Code: 137
```

`grep -ci 'signal\|sigkill'` over the whole log → **0**.

Docker, at the same instant:

```
StartedAt  2026-09-15T22:21:40.942007645Z
FinishedAt 2026-09-15T22:21:46.740817278Z
ExitCode   137
OOMKilled  false
```

`$ --status`, at the same instant:

```
  exitCode 137
  exitReason "signal (SIGKILL)"
```

So `exitReason` exists, is correct, and is thrown away. Once the container is gone, `--status` can no longer produce it either — `readDockerState()` returns `null` and the enrichment branch that computes the reason never runs. The knowledge is lost permanently, even though it was in memory in the process that owned the log file.

## Why this matters in practice

`exitCode=137 oomKilled=false` is the single most ambiguous line a post-mortem can start from. It is consistent with at least: an external `docker kill`, a host OOM killer acting on the container's processes without setting the cgroup flag, a supervisor `kill -9`, and a nested-daemon kill. Distinguishing them needs exactly the facts that were available and not written: the signal, the container lifetime, and the `State` block.

In link-assistant/hive-mind#2244 this cost days: a task container died 5.6 s after start, and the surviving evidence was a 37-line log ending in `Reason: exitCode=137 oomKilled=false`. There was no way to tell whether the workload had ever begun.

## Suggested fix

Extend `buildDetachedDockerCompletionScript()` in `src/lib/docker-cleanup.js` (~line 234). It already runs:

```js
parts.push(
  `__start_command_state=$(docker inspect -f '{{.State.ExitCode}} {{.State.OOMKilled}}' ${quotedName} 2>/dev/null || printf '%s' '-1 false')`
);
```

**1. Fetch the whole picture in that one call** — it is free:

```js
`docker inspect -f '{{.State.ExitCode}} {{.State.OOMKilled}} {{.State.StartedAt}} {{.State.FinishedAt}} {{.State.Error}}' ${quotedName}`
```

**2. Append a post-mortem block to the log** whenever the container is kept (i.e. inside the `else` branch of `buildDockerKeptLogSnippet()`), before the footer:

```
=== Container post-mortem ===
Exit Code:  137 (SIGKILL — 128+9)
OOMKilled:  false
StartedAt:  2026-09-15T22:21:40.942007645Z
FinishedAt: 2026-09-15T22:21:46.740817278Z
Lifetime:   5.8s
Error:
```

The signal decoding is the same mapping `exitReason` already uses (`128 + n` → signal name) — it just needs to move from `status-formatter.js` (query time, in-memory) into the watcher (completion time, on disk). Hoisting it into a shared helper, e.g. `describeExitCode(exitCode)` in `src/lib/isolation-log-utils.js`, lets both call sites share one implementation.

**3. Consider writing the same block on the removal path too.** When the policy removes the container, the loss is total: after `docker rm -f` nothing is inspectable, so a log line is the only possible record. Even a single line — `Container removed (exit 137, SIGKILL, lifetime 5.8s, oomKilled=false)` — closes the gap.

**4. Optionally persist `exitReason`** alongside the record (see #170, which covers the store side of the same gap).

## Workaround

Snapshot the container host-side before anything can remove it:

```bash
docker inspect "$session"          > "$log_path.diagnostics/container-inspect.json"
docker logs   "$session" > "$log_path.diagnostics/container-logs.txt" 2>&1
```

That is what we now do in the supervisor — a sidecar `<session>.log.diagnostics/` directory written at completion time, before reaping — precisely because the session log could not be relied on to carry these facts.

## Context

Found while investigating link-assistant/hive-mind#2244. Full case study and the host-side mitigation: https://github.com/link-assistant/hive-mind/pull/2245

Related: #170 (terminal state / `endTime` not persisted), #138 (session log omits the image-preparation phase) — all three are instances of "a fact was known at the time and not written into the one file that survives".
