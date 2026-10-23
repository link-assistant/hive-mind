# #3048 Docker tasks have no default CPU limit: one CPU-heavy task makes the CPU gate block every tool queue for hours [OPEN]

## Problem

Docker-isolated tasks get a default memory limit (`DEFAULT_DOCKER_TASK_MEMORY = '25%'` in `src/telegram-container-resource-limits.lib.mjs`) but **no default CPU limit**: `cpu` is `config.containerCpu || TELEGRAM_CONTAINER_CPU || ''`, so without `--container-cpu` every task runs with `NanoCpus=0` (all host cores).

The queue's CPU gate then measures the load of the very task it is waiting on. One CPU-heavy task (for example a model training run inside the solve) takes every core, host CPU reads 100%, and the gate (`threshold: 65%`) blocks **every** tool queue, not only the one that task belongs to. Nothing starts until that task ends, which can take many hours.

## Observed (hive-mind 2.34.0, 6 cores / 12 GiB host, `--isolation docker`, no `--container-cpu`)

- One running `--tool claude` task container: `NanoCpus=0 CpuQuota=0`, `docker stats` shows `cpu=543.92% mem=2.705GiB / 2.92GiB`. Its main process is a `python -m … train` run at 533% CPU.
- Host: `%Cpu(s): 96.3 us … 0.0 id`, load average 6.25 on 6 cores. The `hive-mind` bot container uses 0% CPU.
- Bot log, every poll:
  ```
  /queue: CPU 5m load avg: 6.44, cpus: 6, usage: 100%
  /queue: Claude limits not applied for --tool agent
  /queue: Cannot start: CPU usage is 100% (threshold: 65%), Claude process is already running (1 processes)
  /queue: Claude limits not applied for --tool qwen
  /queue: Cannot start: CPU usage is 100% (threshold: 65%), Claude process is already running (1 processes)
  /queue: Throttled: no items can start from any tool queue
  /queue:   claude: waited 8h 38m 59s - blocked by [CPU usage is 100% (threshold: 65%); Claude process is already running (1 processes)]
  /queue:   codex: waited 4h 58m 57s - blocked by [CPU usage is 100% (threshold: 65%); Claude process is already running (1 processes)]
  ```
- 7 items in the claude queue and 7 in the codex queue. The last `Starting:` was 2.5 hours earlier. The codex, agent, qwen and gemini queues have no task of their own running; only the CPU gate blocks them.
- The same task was also OOM-killed inside its memory limit several times (`Memory cgroup out of memory: Killed process … (python) anon-rss:2587092kB`), so it keeps retrying the same heavy job.

## Reproduce

1. Start the bot with `--isolation docker` and no `--container-cpu` / `TELEGRAM_CONTAINER_CPU`.
2. Solve an issue whose work runs a multi-core job for a long time (e.g. `stress-ng --cpu 0` or any `make -j`/training run).
3. Queue a task for any other tool: it waits with `CPU usage is 100% (threshold: 65%)` until the first task ends.

## Workaround

- Live, for the running task: `docker update --cpus <n> <task-container>` (hive-mind already uses `docker update` for its runtime limits via `buildDockerUpdateArgs`).
- For new tasks: start the bot with `--container-cpu 50%` (or `TELEGRAM_CONTAINER_CPU=50%`), then restart it.

## Suggested fix

1. Give Docker tasks a default CPU limit like memory has, e.g. `DEFAULT_DOCKER_TASK_CPU` = the share that keeps one task under the CPU gate threshold (`floor(cores × threshold)` minus a margin, or `50%`), overridable by `--container-cpu`/`TELEGRAM_CONTAINER_CPU` (`unlimited` to opt out).
2. Make the CPU gate fair: when every running task is already at its CPU limit, the CPU it uses is reserved for it and should not block other queues; or compare against the capacity left after the running tasks' limits instead of raw host usage.
3. Log the effective limits per task (`CPU=…, RAM=…`) at `Starting:` so a missing CPU limit is visible, and warn at bot startup when `--isolation docker` runs without a CPU limit.
4. Add a test: a fake task using 100% CPU with the default limit must not block another tool's queue.

We need to download all logs and data related about the issue to this repository, make sure we compile that data to `./docs/case-studies/issue-{id}` folder, and use it to do deep case study analysis (also make sure to search online for additional facts and data), in which we will reconstruct timeline/sequence of events, list of each and all requirements from the issue, find root causes of the each problem, and propose possible solutions and solution plans for each requirement (we should also check known existing components/libraries, that solve similar problem or can help in solutions).

If there is not enough data to find actual root cause, add debug output and verbose mode if not present, that will allow us to find root cause on next iteration.

If issue related to any other repository/project, where we can report issues on GitHub, please do so. Each issue must contain reproducible examples, workarounds and suggestions for fix the issue in code. Also double check to fully apply requirements to entire codebase, so if we have issue in multiple places, it should be fixed in all them.

Please plan and execute everything in this single pull request, you have unlimited time and context, as context auto-compacts and you can continue indefinitely, until it is each and every requirement fully addressed, and everything is totally done.



## Comments

