# Case study: issue #3048, one CPU-heavy Docker task blocks every tool queue

Issue: [#3048](https://github.com/link-assistant/hive-mind/issues/3048), "Docker tasks have no default CPU limit: one CPU-heavy task makes the CPU gate block every tool queue for hours". Related: [#2801](https://github.com/link-assistant/hive-mind/issues/2801) (CPU penalty), [#3125](../issue-3125/README.md) (Docker task memory limits), [#2838](../issue-2838/README.md).

## Data

| File                                       | What it is                                     |
| ------------------------------------------ | ---------------------------------------------- |
| [`data/issue-3048.md`](data/issue-3048.md) | The issue body as it was when this was written |

## Timeline (hive-mind 2.34.0, 6 cores / 12 GiB host, `--isolation docker`, no `--container-cpu`)

| When             | Event                                                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| task start       | A `--tool claude` task starts with `NanoCpus=0 CpuQuota=0` (all host cores) and the default 25% memory limit                                                          |
| during the task  | Its main process, a `python -m … train` run, uses 533% CPU; `docker stats` shows 543.92%. The host is at 96.3% user, 0% idle, load 6.25 on 6 cores                    |
| every queue poll | `/queue: CPU 5m load avg: 6.44, cpus: 6, usage: 100%` and `Cannot start: CPU usage is 100% (threshold: 65%)` for every tool                                           |
| report time      | claude waited 8h 38m, codex 4h 58m; 7 items in each queue. The last `Starting:` was 2.5 hours earlier. codex, agent, qwen and gemini had no task of their own running |
| same task        | The training run is also OOM-killed inside its memory limit several times, so it retries the same heavy job                                                           |

## Requirements

| #   | Requirement                                                                                                                          | Status        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| R1  | A default CPU limit for Docker tasks (e.g. 50%), overridable by `--container-cpu` / `TELEGRAM_CONTAINER_CPU`, `unlimited` to opt out | Done          |
| R2  | A fair CPU gate: CPU a capped task uses is reserved for it and does not block other queues                                           | Done          |
| R3  | Log the effective limits per task at `Starting:`                                                                                     | Done          |
| R4  | Warn at bot startup when Docker isolation runs without a CPU limit                                                                   | Done          |
| R5  | Test: a fake task at 100% of its default CPU limit does not block another tool's queue                                               | Done          |
| R6  | Case study                                                                                                                           | This document |

## Root causes

1. **No default CPU limit.** Memory had a default (`DEFAULT_DOCKER_TASK_MEMORY`), but `cpu` was `config.containerCpu || TELEGRAM_CONTAINER_CPU || ''`. Without `--container-cpu`, a task could use every core.
2. **The CPU gate measured the task it was waiting on.** The gate compares the host's 5-minute load with a threshold (65%). It cannot tell a task's own load from the load of the rest of the host. One task at full host CPU closed the gate for every tool queue until it ended.
3. **Nothing showed the limits.** The `Starting:` line did not name the task's limits, and the bot did not warn when Docker tasks had no CPU limit, so the missing cap went unnoticed for hours.

## Solutions

- **Default CPU cap** (`src/telegram-container-resource-limits.lib.mjs:17,27`):
  - Docker tasks get `DEFAULT_DOCKER_TASK_CPU = '50%'` of the host's logical CPUs.
  - `--container-cpu` and `TELEGRAM_CONTAINER_CPU` override it, and `unlimited` opts out (`src/container-resource-limits.lib.mjs:15-18`).
  - At 50%, one capped task stays below the 65% gate threshold.
  - The cap is applied with `docker update --cpus` behind the start gate, like the other limits.
- **Startup warning** (`src/telegram-container-resource-limits.lib.mjs:48`): with `--isolation docker` and no CPU limit, the bot warns that one CPU-heavy task can block every tool queue.
- **Fair CPU gate** (new `src/queue-fair-cpu-gate.lib.mjs`, used at `src/telegram-solve-queue.throttling.lib.mjs:109-110`):
  - For every running Docker session with a CPU cap (its `--cpus` limit, or its #2801 penalty cap while penalized), `summarizeCappedTaskCpu` averages the `docker stats` samples the CPU penalty pass stores over the last 5 minutes. That is the same span as the load average. Each average is bounded by the session's cap.
  - `computeFairCpuUsage` then works out `fair = max(0, load5 − reserved) / (cpus − capped CPUs)` and uses `min(raw, fair)`. The fair ratio is never above the raw one, so it can only let through work the old gate blocked. Uncapped load still counts in full.
  - Without fresh samples (penalty disabled, a new session, or a stale monitor) the raw ratio decides, as before.
  - The verbose `/queue` log appends the capped tasks, their reserved CPUs and the fair usage.
  - The session list comes from the new `listTrackedSessionEntries` (`src/session-monitor.queries.lib.mjs`, exported by `src/session-monitor.lib.mjs`). The queue can inject it as `getCappedTaskCpuFn` for tests.

  In the incident, a 3-CPU task using 3 cores on a 6-core host with load 3.5 gives fair usage 0.5 / 3 = 17%. That is below 65%, so the other queues start.

- **Limits at `Starting:`** (new `src/queue-task-limits.lib.mjs`):
  - The bot registers its isolation backend and Docker limits at startup (`src/telegram-bot.mjs:83`).
  - The queue appends them to the `Starting:` line (`src/telegram-solve-queue.lib.mjs:829`), resolving percentages on this host, for example `[limits: CPU=50% (3 CPUs), RAM=60% (7.2 GiB), reservation=25% (3.0 GiB), disk=unlimited]`.
  - Tasks without Docker show `[limits: none (screen isolation)]` or `[limits: none (no isolation)]`.
- **Docs:** `docs/DOCKER.md` and `docs/CONFIGURATION.md`, with their translations, plus `.env.example`, give the new default and explain the fair gate.

## Tests

| Test                                                   | Covers                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/issue-3048-fair-cpu-gate.test.mjs` (7)          | The default cap, session caps (penalty vs `--cpus`), which sessions count, usage bounded by the cap, the fair ratio, a task at 100% of its default cap not blocking other tool queues (with an empty-session control that still blocks), and an uncapped task at 100% still blocking |
| `tests/issue-3048-task-limits-visibility.test.mjs` (5) | The default and `unlimited`, the startup warning, resolved percentages, the per-backend suffix, and the real queue logging the limits at `Starting:`                                                                                                                                 |

## Remaining limits

- The fair gate needs the CPU penalty's `docker stats` samples. They exist while the penalty is on, which is the default. With `--no-container-cpu-penalty` the raw ratio decides. The samples are also cleared when a session enters or leaves the penalty, so the raw ratio decides for about one sample interval after that.
- The load average lags. A capped task that just started can still close the gate for a few minutes until its samples arrive.
- The cap was applied with `docker update` behind the start gate, not with start-command's `--cpus` launch flag. That keeps CPU, memory and the #3125 reservation on one path and fails closed. Adding a feature-detected launch flag was not needed, and `isolation-runner.lib.mjs` is close to the file line limit.
