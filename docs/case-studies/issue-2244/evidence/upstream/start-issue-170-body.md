## Summary

For a **detached Docker** session, the terminal state of the run is never written back to the execution store. The record stays `status "executing"`, `exitCode null`, `endTime null` forever, even after the container has exited and start-command's own completion watcher has already appended `Exit Code: 137` to the session log.

`$ --status` hides this by recomputing the state on every query — and while doing so it **fabricates `endTime` from `new Date()`**. The consequence is that `endTime` is not the time the command finished, it is the time you happened to ask. It moves on every query, and it can be arbitrarily far from reality: in the incident that led me here, `$ --status` reported an `endTime` roughly **four days** after the container's real `FinishedAt`, because that was simply when we ran the query.

Reproduced on **start-command 0.33.0** (latest on npm at the time of writing), Node v26.3.0, Linux, Docker isolation.

## Reproduction

Self-contained script (no dependencies beyond `docker`, `node` and `$`):

<details>
<summary><code>start-command-detached-terminal-state.sh</code></summary>

```bash
#!/usr/bin/env bash
# Minimal reproducer: a detached Docker session that is SIGKILLed never gets its
# terminal state persisted, and `$ --status` fabricates `endTime` at query time.
set -euo pipefail

out="${1:-/tmp/start-command-detached-terminal-state}"
session="$(cat /proc/sys/kernel/random/uuid)"
mkdir -p "$out"
trap 'docker rm -f "$session" >/dev/null 2>&1 || true' EXIT

echo "[1/5] launching a detached docker session (session=$session)"
\$ --isolated docker --image alpine:3.20 --shell sh \
  --detached --session "$session" \
  -- 'sleep 300' >"$out/launch.log" 2>&1 || true

log_path="$(grep -o '/tmp/start-command/logs/isolation/docker/[^ ]*\.log' "$out/launch.log" | head -n1)"
execution_id="$(basename "$log_path" .log)"

echo "[2/5] SIGKILL after 5s (exit 137, not an OOM)"
sleep 5
docker kill --signal KILL "$session" >/dev/null 2>&1 || true
sleep 3   # let the detached completion watcher append its block

docker inspect "$session" >"$out/inspect.json" 2>/dev/null || true
cp "$log_path" "$out/session.log"

echo "[3/5] first \$ --status"
\$ --status "$session" >"$out/status-1.txt" 2>&1 || true

echo "[4/5] reading the persisted record straight out of the store"
node -e '
const fs = require("fs");
const text = fs.readFileSync(process.env.HOME + "/.start-command/executions.lino", "utf8");
const decoded = text.replace(/\(str ([A-Za-z0-9+/=]+)\)/g, (_, b64) => `"${Buffer.from(b64, "base64").toString("utf8")}"`);
const at = decoded.indexOf(process.argv[1]);
const slice = at === -1 ? "" : decoded.slice(at, at + 1200);
for (const key of ["status", "exitCode", "endTime"]) {
  const m = slice.match(new RegExp(`"${key}"\\s+([^)]*)`));
  console.log(`persisted ${key} = ${m ? m[1].trim() : "<absent>"}`);
}
' "$execution_id" >"$out/stored-record.txt" 2>&1 || true

echo "[5/5] second \$ --status, 4s later (a *persisted* endTime cannot move)"
sleep 4
\$ --status "$session" >"$out/status-2.txt" 2>&1 || true

{
  echo "container_started_at=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[0].State.StartedAt' "$out/inspect.json")"
  echo "container_finished_at=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))[0].State.FinishedAt' "$out/inspect.json")"
  echo "status_endTime_query_1=$(grep -o 'endTime.*' "$out/status-1.txt" | head -n1)"
  echo "status_endTime_query_2=$(grep -o 'endTime.*' "$out/status-2.txt" | head -n1)"
  cat "$out/stored-record.txt"
} | tee "$out/summary.txt"
```
</details>

## Observed output

```
container_started_at=2026-09-15T22:21:40.942007645Z
container_finished_at=2026-09-15T22:21:46.740817278Z
status_endTime_query_1=endTime "2026-09-15T22:21:50.337Z"
status_endTime_query_2=endTime "2026-09-15T22:21:54.723Z"
persisted status = "executing"
persisted exitCode = (null
persisted endTime = (null
```

Three distinct problems are visible in those six lines:

1. **Nothing terminal is persisted.** The container exited at `22:21:46.740`, `docker inspect` says `ExitCode: 137`, and the session log already ends with `Finished: 2026-09-15 22:21:47.014` / `Exit Code: 137` — yet the store still says `executing` / `null` / `null`.
2. **`endTime` is fabricated at query time.** Query 1 says `22:21:50.337Z`, query 4 seconds later says `22:21:54.723Z`. Neither is the finish time; both are "now".
3. **`endTime` drifts unboundedly.** Since it is always "now", querying a week later yields a timestamp a week after the real finish. That is exactly what bit us: a container that died on `2026-09-09 17:43:07` was reported with an `endTime` of `2026-09-13…`, which sent the investigation down the wrong path (we believed the task had run for days).

Once the container is removed (`docker rm -f`), the `--status` output does become terminal (`status executed`) — but by then `exitCode` and `endTime` are derived from the log footer / the `-1` fallback, and `endTime` is still `new Date()`.

## Root cause in the code

The detached completion watcher already has the authoritative facts — it inspects the container and reads `.State.ExitCode` and `.State.OOMKilled` — but it only uses them to decide whether to remove the container and what to print into the log. It never calls back into the execution store:

`src/lib/docker-cleanup.js` (`buildDetachedDockerCompletionScript`, ~line 234):

```js
parts.push(`docker logs -f ${quotedName} >> ${quotedLogPath} 2>&1`);
parts.push(
  `__start_command_state=$(docker inspect -f '{{.State.ExitCode}} {{.State.OOMKilled}}' ${quotedName} 2>/dev/null || printf '%s' '-1 false')`
);
parts.push('__start_command_exit=${__start_command_state%% *}');
parts.push('__start_command_oom=${__start_command_state##* }');
…
parts.push(`${createShellLogFooterSnippet()} >> ${quotedLogPath}`);
```

`__start_command_exit` reaches the log and then is dropped on the floor. The record in `~/.start-command/executions.lino` is never updated, so every later reader has to re-derive the outcome.

That re-derivation is `resolveDetachedStatus()` in `src/lib/status-formatter.js`, which fills the hole with wall-clock time in three places:

```js
// line 271
if (!enriched.endTime) {
  enriched.endTime = new Date().toISOString();
}
// line 285 (same, for the OOM branch)
// line 327 (same, for the "not alive but record says executing" branch)
```

`src/lib/execution-store.js:668` does the same for stale records (`currentRecords[index].endTime = new Date().toISOString()`).

`new Date()` is a correct default only when the record is being finalized *at the moment the process ends*. In the detached-Docker path it is being finalized whenever someone happens to run `--status`, which can be days later, so the value is not an approximation of the finish time — it is unrelated to it.

## Suggested fix

**1. Persist the terminal state from the completion watcher.** The watcher is the one place that reliably observes the end of the run. After the `docker inspect` line in `buildDetachedDockerCompletionScript()`, add a step that writes the outcome back, e.g. by invoking the CLI's own store from the same shell script:

```js
parts.push(
  `${shellQuote(process.execPath)} ${shellQuote(finalizeScriptPath)} ` +
  `${shellQuote(executionId)} "$__start_command_exit" "$__start_command_oom" ` +
  `"$(docker inspect -f '{{.State.FinishedAt}}' ${quotedName} 2>/dev/null)" ` +
  `>/dev/null 2>&1 || true`
);
```

where `finalize.js` loads `ExecutionStore`, sets `status = executed`, `exitCode`, `oomKilled` and `endTime` from the passed `FinishedAt`, and saves under the existing lock. `docker inspect -f '{{.State.ExitCode}} {{.State.OOMKilled}}'` is already being run there, so extending it to `'{{.State.ExitCode}} {{.State.OOMKilled}} {{.State.StartedAt}} {{.State.FinishedAt}}'` costs nothing.

**2. Stop inventing `endTime`.** In `resolveDetachedStatus()`, derive it, in order of preference, from:
   * `dockerState` — `.State.FinishedAt` (already fetched by `readDockerState()` for docker records; it is the ground truth);
   * the log footer, which already carries `Finished: 2026-09-15 22:21:47.014` next to the `Exit Code:` line the function parses anyway (`parseExitCodeFromTail` could return both);
   * only then fall back — and when falling back, mark it, e.g. `endTimeSource: "observed-at"` or leave `endTime` null and expose `observedAt` instead. A `null` endTime is honest; a wrong one silently corrupts every downstream duration calculation.

The same applies to `execution-store.js:668`: a stale-record sweep genuinely does not know when the process died, so `endTime` there should be recorded as an observation (`staleDetectedAt`) rather than as the finish time.

**3. (Minor, same area.)** `$ --status` reports `status executed` together with `exitCode 137` and `exitReason "signal (SIGKILL)"`. `executed` reading as "finished" is defensible, but a consumer that branches on `status` alone treats a SIGKILLed run as a completed one. Consider a distinct terminal status (`killed`/`terminated`) or documenting explicitly that `status` only means "no longer running".

## Workaround

Do not trust `endTime` (or `status`) from `--status` for detached Docker sessions. Take the timestamps from Docker before the container is removed:

```bash
docker inspect -f '{{.State.StartedAt}} {{.State.FinishedAt}} {{.State.ExitCode}} {{.State.OOMKilled}}' "$session"
```

and persist that snapshot host-side yourself. That is what we ended up doing — we now capture `docker inspect` + `docker logs` into a sidecar directory before reaping the container, because the session record could not be relied on.

## Context

Found while investigating link-assistant/hive-mind#2244, where a Docker-isolated task was SIGKILLed 5.6 s into startup and the only surviving artifacts were a 37-line session log and a `$ --status` output whose `endTime` was days off. Full case study: https://github.com/link-assistant/hive-mind/pull/2245
