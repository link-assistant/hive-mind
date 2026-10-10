# Case study: issue #2917 — `/limits` shows `processing: 0` for running docker-isolated tasks

- Issue: https://github.com/link-assistant/hive-mind/issues/2917
- Pull request: https://github.com/link-assistant/hive-mind/pull/2918
- Upstream report: https://github.com/link-foundation/start/issues/199 (`--label` passthrough and default `start-command.*` labels)
- Related: #2887, #2889, #2890, #2892, #2900, link-foundation/start#193

## Data collected

| File                                  | What it is                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `data/issue-2917.json`                | Issue body and metadata, as filed.                                                                       |
| `data/related-hive-mind-*.json`       | Titles/states of the related 2026-10-09 incident issues.                                                 |
| `data/upstream-start-193.json`        | The start-command report about the stale execution record (`Failed to acquire lock for database write`). |
| `data/experiment-docker-markers.log`  | Output of `experiments/issue-2917-docker-task-containers.mjs` against a real docker 29.8.0 daemon.       |
| `upstream/start-label-passthrough.md` | Body of link-foundation/start#199 as filed.                                                              |

## Timeline (UTC)

| When                      | Event                                                                                                                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-09, before 14:32  | The host's dockerd is OOM-killed. Its restart kills the bot's root container and every task container (#2892, #2900).                                                                                                                                    |
| 2026-10-09 ~14:32         | start-command's `executions.lock` is left dead (0 bytes). From then on no execution record can be saved (link-foundation/start#193).                                                                                                                     |
| 2026-10-09, after restart | The bot's kill recovery fails (`sh: /codex: not found`, exit 127 — #2887). It emits `session_completed … "status":"oom-killed"`/`"failed"` for the four `/codex` sessions (router #724, #725, #727, #728) and removes them from `sessions.json`.         |
| 2026-10-09                | An operator script resumes the four tasks with `$ --resume <uuid>` (docker-snapshot mode). New containers `<uuid>-resume-1` (and `-resume-1-resume-2`) start. `$ --resume` then fails to save the record, so `$ --status` still says `executed 137/127`. |
| 2026-10-09 14:50–15:18    | #2887, #2889, #2890, #2892, #2900 filed; link-foundation/start#193 filed at 15:03.                                                                                                                                                                       |
| 2026-10-09 16:28          | #2917 filed: `/limits` shows `codex (pending: 0, processing: 0)` while 4 codex tasks run.                                                                                                                                                                |
| 2026-10-10 06:48          | `292b4aec`: the queue counts running task containers; `/limits` shows `untracked`.                                                                                                                                                                       |
| 2026-10-10 07:02          | `9b5e8620`: the monitor follows operator-resumed containers and adopts orphans.                                                                                                                                                                          |

## Requirements (from the issue)

| #   | Requirement                                                                                                                     | Status                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Count docker-isolated tasks from ground truth (running task containers), attributed to a tool.                                  | Done — `src/docker-task-containers.lib.mjs`, `src/telegram-solve-queue.external.lib.mjs`                                                                                     |
| R1a | Attribute containers at launch (labels in the issue). Re-apply on `$ --resume`.                                                 | Done with env markers (`HIVE_MIND_TOOL`, `HIVE_MIND_TASK_URL`) because start-command has no `--label`; upstream #199 filed. They survive `docker commit` (verified).         |
| R1b | Fallback for older, unmarked containers.                                                                                        | Done — tool detected from the container's command (`solve <url> --tool codex`), name/root matched to tracked sessions.                                                       |
| R2  | Adopt orphans periodically, re-tracking them with url/tool/uuid. Send their completion notice and keep `sessions.json` correct. | Done — `src/session-monitor.adopt.lib.mjs` (every monitor tick), `src/session-monitor.resume-follow.lib.mjs`                                                                 |
| R3  | Use `pgrep` only where it can see the tasks.                                                                                    | Done — `byTool = max(pgrep, tracked + containers)`. pgrep still covers screen/tmux/none, and containers cover docker. Neither source double-counts.                          |
| R4  | `/limits` shows untracked tasks, e.g. `codex (pending: 0, processing: 4, 2 untracked)`.                                         | Done — `queue_untracked` in en/ru/zh/hi                                                                                                                                      |
| R5a | Test: a running attributed container not in `activeSessions` is counted, adopted, and blocks one-at-a-time for its tool.        | `tests/test-issue-2917-docker-task-containers.mjs`, `tests/test-issue-2917-orphan-adoption.mjs`                                                                              |
| R5b | Test: `$ --status` `executed` for a running container is counted as running.                                                    | Both test files (queue count and monitor state)                                                                                                                              |
| R6  | Case study with data, timeline, root causes, solutions, existing tools, online research.                                        | This document                                                                                                                                                                |
| R7  | Debug/verbose output to find root causes next time.                                                                             | `[VERBOSE] docker-task-containers: …`, `External processing (issue #2917): containers=… untracked=…` (queue verbose log), follow/adopt messages, `session_adopted` log event |
| R8  | Report upstream issues with repro, workaround, fix.                                                                             | link-foundation/start#199                                                                                                                                                    |
| R9  | Apply everywhere the wrong count is used.                                                                                       | `/limits` (`formatStatus`), `canStartCommand` (system resources, API limits, one-at-a-time), `findStartableItems` (per-tool count) all read the same snapshot                |

## Root causes

1. **`pgrep` sees only the bot container's PID namespace.** Under `--isolation docker` every AI CLI runs in a sibling container, so `getRunningProcesses()` counts 0 for those tasks.
2. **The tracked count only covered the in-memory registry.** `activeSessions` is filled by tasks the bot launched and, once at startup, from `sessions.json`. The four sessions had been completed (wrongly) by the failed recovery, so nothing tracked them. Tasks resumed outside the bot were never adopted.
3. **`$ --status` was stale.** start-command could not save records after the dead lock (start#193), so even a tracked session would read `executed 137`. A docker terminal status with no log footer was only cross-checked against container liveness for failures (#2134), not for `executed 0`.
4. **The operator resume creates a new container name.** Snapshot resume runs the work on in `<name>-resume-<n>`. A tracked session that points at `<name>` sees a dead container, and nothing related the two.

The same snapshot drives dispatch (`checkSystemResources`, `checkApiLimits` one-at-a-time, per-tool counts), so new codex tasks were dispatched as if none ran. On an 11.7 GB host, with each task using about 2.4 GiB, that is how the overcommit leads to OOM.

## Correction to the issue text

The issue says `docker commit` does not carry container labels to the new container. The experiment (`experiments/issue-2917-docker-task-containers.mjs`, log in `data/experiment-docker-markers.log`) shows otherwise on docker 29.8.0. A label and env set on the original container are both present on the container started from the committed image (`label hive-mind.tool on resumed container: "codex"`). The commit copies the container's `Config` (including `Env` and `Labels`) into the image config. The Docker docs for `docker commit` show env carried over and allow `--change LABEL …`, but do not spell out the label behaviour. Re-applying labels on resume (as #199 suggests) is still the robust choice.

## Solution

### Counting (queue, `/limits`, dispatch)

- `listRunningTaskContainers()` runs `docker ps -q --no-trunc` followed by one `docker inspect`. It never throws, and returns `{available:false}` without docker. `getRunningTaskContainers` caches the result for 5 s, so `/limits` and dispatch do not spawn docker for every call.
- A container is a task when its env carries `HIVE_MIND_TOOL` (set at launch by `buildDockerIsolationStartArgs`) or its command is `solve|hive … --tool <tool>`. Its root session is the name with `-resume-<n>` suffixes stripped.
- `mergeExternalProcessingSnapshot()`:
  - `docker[tool] = max(tracked docker sessions, containers)`
  - `isolated[tool] = tracked non-docker + docker[tool]`
  - `byTool[tool] = max(pgrep, isolated[tool])`

  Containers no tracked session accounts for are `untracked`.

- `formatStatus` appends `N untracked`. `findStartableItems` adds the external per-tool count, so one-at-a-time holds the codex head while other tools still start.

### Monitoring

- **Follow:** when a tracked docker session is terminal and a `<sessionId>-resume-<n>` container is running, the session is re-pointed at it (`sessionId`, `followedResumeOf`, `attemptStartedAt`). Sessions the bot's own kill recovery took over (`killRecoverySessionId`) are left alone.
- **Footer scope:** `scopeRecoveryFooter` ignores a footer older than `attemptStartedAt`, so the dead container's `exit 137` footer in a shared log does not end the followed session.
- **Stale status:** a footer-less docker terminal status with a live container stays running, whatever the exit code.
- **Adopt:** every monitor tick, untracked task containers older than 2 minutes are matched against the newest `track` event of the same chain in `sessions-events.jsonl`. Only the last 8 MiB are scanned. A match is re-tracked under the original session key, with chat, message, URL, tool and args. Its stale completion latch is cleared, so the real end is reported there and persisted. A container with no record is not adopted: nobody can be notified. It is counted and shown as untracked, and remembered so the log is not rescanned every tick.

## Alternatives and existing tools considered

- **Docker labels + `docker ps --filter label=…`** (the issue's proposal): best, because the daemon can filter labels server-side. It is blocked by start-command lacking `--label` (#199). Env markers give the same attribution at the cost of one `docker inspect` per running container. `docker ps` has no `env` filter (filters: `id`, `name`, `label`, `exited`, `status`, `ancestor`, `before`/`since`, `volume`, `network`, `publish`/`expose`, `health`, `isolation`, `is-task`).
- **`docker ps --filter ancestor=start-command-resume/<uuid>`:** finds resume chains, but not first-run containers. It is not needed once names are parsed.
- **`$ --list` records:** unreliable in exactly this incident (start#193).
- **`docker top <container>`:** gives per-process counts. It is not needed, because one task container is one task.
- **Docker `live-restore`** (#2900): prevents the dockerd restart from killing tasks at all. It is complementary.

## Remaining limits

- Containers launched before this change have no env markers. They are attributed from their command line, which covers `solve`/`hive` with `--tool`. A container whose tool cannot be detected is ignored by the count.
- Adoption needs the bot's own event log. Containers from another bot instance on the same daemon are counted but not adopted.
- `tests/test-telegram-solve-queue.mjs` "Queue formatStatus" fails on the base commit too (`status1.includes is not a function`). It is unrelated to this change.
