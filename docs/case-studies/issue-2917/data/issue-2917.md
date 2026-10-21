# #2917 /limits shows processing: 0 for running docker-isolated tasks (pgrep sees only the bot container, tracked count is in-memory only), and dispatch throttling uses the same wrong count

labels: []

## Problem

`/limits` shows `codex (pending: 0, processing: 0)` while **four** `/codex` tasks are running (`--isolation docker`, link-assistant/router #724, #725, #727, #728). Each one has a live `codex exec resume <thread>` process writing to its rollout every few seconds.

```
Queues
claude (pending: 0, processing: 0)
agent (pending: 0, processing: 0)
codex (pending: 0, processing: 0)      ← 4 codex tasks running
qwen (pending: 0, processing: 0)
gemini (pending: 0, processing: 0)
```

Context: the 2026-10-09 incident (#2892, #2887, #2889, #2900). The host dockerd was OOM-killed and its restart killed the root container and all tasks. The bot's kill recovery failed (#2887), and the four tasks were then resumed by an operator recovery script (`$ --resume <uuid>`, docker-snapshot mode). That script was written because the built-in recovery failed.

## Root causes

The count is computed by `getExternalProcessingSnapshot()` in `src/telegram-solve-queue.lib.mjs` as `max(pgrep count, tracked isolated sessions)`. Both sources miss docker-isolated tasks the bot is not tracking in memory:

1. **`pgrep -x codex` runs in the bot container's PID namespace** (`getRunningProcesses()` in `telegram-solve-queue.helpers.lib.mjs`). With `--isolation docker`, every AI CLI process runs in a sibling container, so this source is **always 0** for docker isolation.
2. **The tracked-session count only covers the in-memory `activeSessions` map** (`getRunningTrackedIsolationSessions()` in `session-monitor.queries.lib.mjs`). That map is filled only by tasks the bot launched itself and, once, at startup from `~/.hive-mind/state/sessions.json` (`resumeTrackedSessions()` in `bot-lifecycle.lib.mjs`). Here the bot had already emitted `session_completed … "status":"oom-killed"` / `"failed"` for all four sessions during its failed recovery, so `sessions.json` has **0 entries**. Tasks resumed outside the bot are never adopted.
3. **Even for tracked sessions, liveness comes from `$ --status`**, which reports these running tasks as `executed 137/127`. start-command could not save any record since 14:32 UTC because of a dead 0-byte `executions.lock` (root cause in link-foundation/start#193).

## Why it matters beyond the display

The same snapshot drives dispatch. `canStartCommand()` uses `totalProcessing = this.processing.size + externalProcessing.total` for `checkSystemResources()`, and `hasRunningToolProcess`/`toolProcessingCount` for `checkApiLimits()` and one-at-a-time per tool. With four codex tasks invisible, the bot will start new codex tasks as if none were running. On this host (11.7 GB RAM, each task using 2.3–2.5 GiB of its 2.92 GiB limit) that is exactly the overcommit that leads to OOM kills.

## Suggested fix

1. **Count from ground truth, not memory.** For `--isolation docker`, list running task containers on the daemon the bot launches into. Add labels at launch, e.g. `--label hive-mind.tool=codex --label hive-mind.url=<issue/pr url> --label start-command.uuid=<uuid>`. Today task containers carry only the image labels, so they cannot be attributed. Re-apply the labels on every `$ --resume` `docker run`, because `docker commit` does not carry container labels to the new container. Then `processing[tool] = count(docker ps --filter label=hive-mind.tool=<tool>)`. For older unlabeled containers, fall back to `$ --list` records whose `options.sessionName` (or `sessionNameHistory`) family matches a running container name.
2. **Adopt orphans.** When a labelled (or `$ --list`-matched) running task container is not in `activeSessions`, re-track it with url/tool/uuid from its labels or record. The bot then monitors it, sends the completion notice, and keeps `sessions.json` correct. Do this periodically, not only at startup. Together with #2890 (durable queue/state), a root-container restart then continues monitoring everything that is actually running.
3. **Use `pgrep` only for `--isolation none`.** For docker isolation, if a per-process count is wanted, use `docker top <container>` on the attributed containers.
4. **Show the source in `/limits`** (e.g. `codex (pending: 0, processing: 4, 2 untracked)`), so an untracked or orphaned task is visible instead of silently counted as 0.
5. Tests: a running labelled container that is not in `activeSessions` must be counted, adopted, and must block one-at-a-time dispatch for its tool. `$ --status` reporting `executed` for a container that `docker ps` shows as running must be counted as running.

Related: #2887, #2889, #2890, #2892, #2900, link-foundation/start#193.

---

We need to download all logs and data related about the issue to this repository, make sure we compile that data to `./docs/case-studies/issue-{id}` folder, and use it to do deep case study analysis (also make sure to search online for additional facts and data), in which we will reconstruct timeline/sequence of events, list of each and all requirements from the issue, find root causes of the each problem, and propose possible solutions and solution plans for each requirement (we should also check known existing components/libraries, that solve similar problem or can help in solutions).

If there is not enough data to find actual root cause, add debug output and verbose mode if not present, that will allow us to find root cause on next iteration.

If issue related to any other repository/project, where we can report issues on GitHub, please do so. Each issue must contain reproducible examples, workarounds and suggestions for fix the issue in code. Also double check to fully apply requirements to entire codebase, so if we have issue in multiple places, it should be fixed in all them.

Please plan and execute everything in this single pull request, you have unlimited time and context, as context auto-compacts and you can continue indefinitely, until it is each and every requirement fully addressed, and everything is totally done.

## comments
