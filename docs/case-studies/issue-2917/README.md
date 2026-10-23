# Case study: issue #2917, `/limits` shows `processing: 0` for running docker tasks

## Data

- [data/issue-2917.md](data/issue-2917.md): the issue text.
- Related incident: 2026-10-09, the host `dockerd` was OOM-killed and its restart killed the root container and every task (#2892, #2887, #2889, #2890, #2900). Four `/codex` tasks (link-assistant/router #724, #725, #727, #728) were then resumed by an operator script with `$ --resume <uuid>`.
- Upstream: [link-foundation/start#193](https://github.com/link-foundation/start/issues/193), a dead 0-byte `executions.lock` that stopped start-command from saving execution records.

## Timeline (2026-10-09, UTC)

1. 12:11: the host `dockerd` is OOM-killed. Its restart SIGKILLs the root `hive-mind` container and the four codex task containers.
2. 13:31: the root container is started again. The bot's kill recovery fails (#2887) and records `session_completed` (`oom-killed` / `failed`) for all four sessions, so `~/.hive-mind/state/sessions.json` ends up with no entries.
3. Later: an operator script resumes the four tasks outside the bot (`$ --resume`, docker snapshot mode).
4. `/limits` shows `codex (pending: 0, processing: 0)` while four codex tasks run. The queue would start new codex tasks as if none were running, on a host where each task uses 2.3 to 2.5 GiB of an 11.7 GB total.

## Requirements

| #   | Requirement                                                                                               | Status                                                                                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Count docker tasks from ground truth (`docker ps`), with labels set at launch and re-applied on resume    | Done. `hive-mind.*` labels go through start-command `--label` (0.37.0+), which re-applies them on `$ --resume`. `docker ps` is read without a label filter, so unlabelled containers of older tasks are matched to `$ --list` records. |
| R2  | Adopt running task containers the bot does not track, periodically                                        | Done. A periodic adoption tracks them after a 2-minute grace period. They are monitored, recorded in `sessions.json` and have no chat to notify.                                                                                       |
| R3  | Use `pgrep` only without docker isolation; count a container `docker ps` shows running even if `executed` | Done for the count: under docker the pgrep counts are ignored and a running container counts whatever `$ --status` says.                                                                                                               |
| R4  | Show the source in `/limits`                                                                              | Done: `codex (pending: 0, processing: 4, 2 untracked)`.                                                                                                                                                                                |
| R5  | Tests: an untracked labelled container is counted, adopted and blocks one-at-a-time dispatch              | Done in `tests/issue-2917-task-container-counting.test.mjs` with a stubbed `docker ps`. No test kills a real container.                                                                                                                |

## Root causes

1. `getExternalProcessingSnapshot()` took `max(pgrep, tracked isolated sessions)`. `pgrep` runs in the bot container's PID namespace, so under `--isolation docker` it is always 0.
2. The tracked count only covers the in-memory `activeSessions` map, which is filled by the bot's own launches and once at startup from `sessions.json`. Tasks resumed outside the bot, or dropped by a failed recovery, are invisible.
3. Task containers carried no labels, so nothing could attribute a running container to a tool or a URL.
4. The kill-recovery resource gate and `findStartableItems()` used `getProcessingCountByTool()`, the queue's own `processing` map. That map is empty once a task has been handed off to its detached session, so even tracked tasks did not block one-at-a-time starts.

## Solution

- `src/task-container-labels.lib.mjs` builds the labels (`hive-mind.tool`, `hive-mind.url`, `hive-mind.command`, `hive-mind.session`, `hive-mind.instance`). `src/isolation-runner.lib.mjs` passes them to start-command, and the callers pass the task URL (`taskUrl`).
- `src/task-container-inventory.lib.mjs` reads `docker ps` and attributes each container by its labels, a `$ --list` solve/hive record, or a tracked session. It produces per-tool counts and the untracked count. It runs only under docker isolation and is cached briefly.
- `src/telegram-solve-queue.lib.mjs` merges these counts into the external snapshot (`mergeTaskContainerCounts`). `getEffectiveProcessingCountByTool()` is `max(own processing, observed)`, and both `findStartableItems()` and the recovery gate (`src/session-kill-resume.resource-gate.lib.mjs`) use it.
- `src/task-container-adoption.lib.mjs` adopts untracked containers. `HIVE_MIND_INSTANCE_ID` limits adoption to a bot's own containers when several bots share a daemon. `src/session-monitor.lib.mjs` skips the completion message, and `src/session-recovery-lifecycle.lib.mjs` the recovery notices, for adopted sessions, which have no chat.
- `src/solve-queue-bot-wiring.lib.mjs` turns all of this on from `src/telegram-bot.mjs`.

## Existing components used or checked

- start-command `--label KEY=VALUE` (0.37.0+): labels are stored in the execution record and re-applied by `execution-resume`, so a `docker commit` + `docker run` resume keeps them. The `start-command.*` keys are reserved. Installed: 0.37.8; the Dockerfiles pin 0.38.0.
- `listTrackedSessionEntries()` from the session monitor gives the tracked identities, so the monitor needed no new export.
- `docker top` per container was not needed: the count is per container, one task per container.

## Upstream

- [link-foundation/start#193](https://github.com/link-foundation/start/issues/193) (already filed): a dead `executions.lock` stops `$ --list` / `$ --status` from updating. The `docker ps` count does not depend on it.
- A "labels are lost on resume" report is not needed: start-command already re-applies them.

## Limits

- Adopted sessions have no Telegram chat, so their end and their recovery lifecycle are logged and recorded, not announced (`src/session-monitor.lib.mjs`, `src/session-recovery-lifecycle.lib.mjs`).
- No end-to-end test with a real Docker daemon.
