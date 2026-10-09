# Case study: configurable delayed CPU penalty per Docker container (issue #2801)

- Issue: https://github.com/link-assistant/hive-mind/issues/2801
- Pull request: https://github.com/link-assistant/hive-mind/pull/2802
- start-command feature request: https://github.com/link-foundation/start/issues/189

## 1. The issue

> If any task uses all 100% of virtual machine CPUs for more than 15 minutes it should be restricted to 2 CPUs per docker container until for at least 15 minutes average CPU usage is below 65% of total CPU cores, meaning 32.5% + 32.5% load on both CPUs is still ok to lift off the restriction, from that moment we monitor for next 15 minutes, if again usage is more than total machine cores (like more than 6 cores at the moment (it should be dynamic value) for at least 15 minutes the task again will be restricted.
>
> That should be by default for Hive Mind and isolation docker, and optional for https://github.com/link-foundation/start (if such feature is missing there we should design it so it will be convenient for us and report it, after that we will pause pull request execution until all delivered in start-command).

The full issue is saved in [`data/issue-2801.json`](data/issue-2801.json).

### Collected data

| File                                                                                                   | What it is                                                                                                                      |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| [`data/issue-2801.json`](data/issue-2801.json)                                                         | Issue body and metadata (`gh issue view --json`)                                                                                |
| [`data/docker-update.log`](data/docker-update.log)                                                     | `experiments/issue-2801-docker-update-cpus.sh`: what `docker update` does to `NanoCpus`, `CpuQuota` and cgroup v2 `cpu.max`     |
| [`data/docker-lift.log`](data/docker-lift.log)                                                         | `experiments/issue-2801-docker-lift-cpus.sh`: capping a busy container, reading `cpu.stat`, and the possible ways to lift a cap |
| [`data/penalty-e2e.log`](data/penalty-e2e.log)                                                         | `experiments/issue-2801-penalty-e2e.mjs`: the real implementation applying and lifting the penalty on a live container          |
| [`data/start-command-docker-resource-limits.js.txt`](data/start-command-docker-resource-limits.js.txt) | start-command's `js/src/lib/docker-resource-limits.js`, which re-applies `NanoCpus` on `--resume`                               |
| [`data/start-command-feature-request.md`](data/start-command-feature-request.md)                       | The body of the start-command feature request (start#189)                                                                       |

### Timeline

| When (UTC)       | Event                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| 2026-10-08 14:38 | Issue #2801 opened                                                                             |
| 2026-10-08 14:49 | Draft PR #2802 opened                                                                          |
| 2026-10-08 18:19 | Docker behaviour probed on the CI-like host (`data/docker-update.log`, `data/docker-lift.log`) |
| 2026-10-08 18:20 | Implementation committed. start-command feature request filed as start#189                     |
| 2026-10-08 18:25 | End-to-end run against a real container (`data/penalty-e2e.log`)                               |

## 2. Requirements

| #   | Requirement                                                                                                                            | Source                                                           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| R1  | Detect a task whose container uses all (100%) of the machine's CPUs for more than 15 minutes                                           | "uses all 100% of virtual machine CPUs for more than 15 minutes" |
| R2  | Restrict that task to 2 CPUs, per Docker container                                                                                     | "restricted to 2 CPUs per docker container"                      |
| R3  | Keep the restriction until the 15-minute average is below 65% of the cap (32.5% + 32.5% of the total over the two CPUs)                | "until for at least 15 minutes average CPU usage is below 65%"   |
| R4  | After the lift, observe again from scratch. Another 15 minutes on all CPUs restricts the task again                                    | "from that moment we monitor for next 15 minutes ..."            |
| R5  | "All CPUs" is the machine's current core count (6 today), read dynamically                                                             | "(it should be dynamic value)"                                   |
| R6  | Make the delays, thresholds and cap configurable                                                                                       | Title: "Configurable delayed CPU penalty"                        |
| R7  | On by default for Hive Mind with `--isolation docker`                                                                                  | "That should be by default for Hive Mind and isolation docker"   |
| R8  | Optional in start-command. If it is missing there, design it and report it                                                             | "optional for https://github.com/link-foundation/start ..."      |
| R9  | Pause the pull request until start-command delivers                                                                                    | "after that we will pause pull request execution ..."            |
| R10 | Collect the data in `docs/case-studies/issue-2801`, research online, list requirements, propose solutions and check existing libraries | Second paragraph of the issue                                    |

### Interpretation and assumptions

- **"100% of CPUs" uses a 95% trigger by default.** A task practically never reads exactly 600% in `docker stats`, because sampling, I/O waits and the bot's own processes take a little time. So "all CPUs" means a 15-minute average of at least 95% of capacity. Setting `--container-cpu-penalty-trigger 100%` gives the literal reading.
- **Capacity is per container.** The issue says "if any task uses". Capacity is the host CPU count, or the task's `--container-cpu` limit when that is lower. A task that is already limited to 4 CPUs counts as busy at 4 cores. Otherwise it could never trigger.
- **The release threshold is relative to the cap.** "65% of total CPU cores, meaning 32.5% + 32.5% load on both CPUs" is read as 65% of the two capped CPUs, which is 1.3 cores. In `docker stats` terms that is 130%: each CPU about 65% busy, which is 32.5% + 32.5% of the two-CPU total.
- **Rolling averages, not momentary samples.** The average is computed over samples that cover the whole window. A window counts only if the samples reach back to its start (within 60 s) and there are at least 5 of them. So a bot restart or a missed tick cannot trigger a penalty on two fresh samples.
- **The lift restores the previous limit.** That is the task's `--container-cpu` value, or the host CPU count when there was none. `docker update --cpus` cannot be "unset" (see §4).
- **Observation restarts after each transition.** Samples are discarded on apply and on lift. So both the release and the re-trigger need a full fresh window.

## 3. Existing components and prior art

| Component                           | What it does                                                                                | Fit for this issue                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker update --cpus` (Docker CLI) | Changes a running container's CPU quota (cgroup v2 `cpu.max`) without restarting it         | **Used.** Live, no restart, and the container keeps running. Conflicts with `--cpu-period`/`--cpu-quota` on the same call.                                                                      |
| `docker stats --no-stream`          | One-shot CPU% per container (`cpu_delta / system_delta × online_cpus × 100`, 100% = 1 core) | **Used.** One call per monitor tick for all containers. It fails completely if any named container is missing, so callers must tolerate that.                                                   |
| cgroup v2 `cpu.stat` / `cpu.max`    | `usage_usec`, `nr_throttled`, `throttled_usec`; `cpu.max` = quota/period                    | Alternative sampler. Exact, but the bot does not run in the container's cgroup namespace, and the cgroup path depends on the Docker driver.                                                     |
| Linux PSI `cpu.pressure`            | Share of time tasks waited for CPU (`some avg10/avg60/avg300`, kernel ≥ 4.20)               | Good host-level signal ("the machine is starved"), but it does not say which container is to blame. Could gate the penalty in the future.                                                       |
| systemd `CPUQuota=` / `CPUWeight=`  | Static quota or weight per unit                                                             | Static, not delayed. Hive Mind tasks are Docker containers, not systemd units.                                                                                                                  |
| cpulimit                            | SIGSTOP/SIGCONT throttling of a process                                                     | Coarse, process-level, and it needs a PID inside the container. cgroup quotas are the modern equivalent.                                                                                        |
| Ananicy (auto-nice daemon)          | Renices processes by rule; archived upstream                                                | Rule-based niceness, no time windows, no containers.                                                                                                                                            |
| systemd-oomd                        | Kills cgroups under memory pressure (PSI)                                                   | Memory only, and kill-based. Similar "pressure over a window" idea.                                                                                                                             |
| Kubernetes CPU limits (CFS quota)   | Static per-pod quota; the kubelet exposes throttling counters                               | Static. The literature on Kubernetes throttling shows quotas add latency even at low average use, which is why the cap here is temporary and why the release threshold sits well below the cap. |
| AWS T3 burstable instances          | CPU credits: burst above baseline until credits run out, then throttle to baseline          | Closest product analogue: "fast while it is fair, throttled after sustained use, recovers once usage drops". Credits are a smoother model; the issue asks for fixed windows instead.            |

No existing tool applies a delayed, reversible cap to a Docker container based on its own sustained usage. The pieces it needs are already in Docker (`docker stats`, `docker update`), so the feature is a small state machine on top of them. No new dependency is needed.

## 4. Experiments

All experiments ran on the development VM (6 CPUs, cgroup v2, Docker 29.8.0). The scripts are in [`experiments/`](../../../experiments).

1. **`docker update` semantics** ([`data/docker-update.log`](data/docker-update.log), [`data/docker-lift.log`](data/docker-lift.log)):
   - `docker update --cpus 2` on a running container sets `NanoCpus=2000000000` and `cpu.max=200000 100000` immediately. A container burning 3 cores drops from 306% to 205% in `docker stats`, and `cpu.stat` starts counting `nr_throttled`.
   - `--cpus 0` is a **no-op**: it does not remove the cap.
   - `--cpu-quota -1` removes the quota in the cgroup but leaves a stale `NanoCpus=2000000000` in `docker inspect`. That stale value is then what start-command re-applies on `--resume` (see the next item).
   - `--cpus <host NCPU>` lifts the cap cleanly. Values above the host CPU count are rejected ("range of CPUs is from 0.01 to 6.00"). So the lift uses `min(base limit, host NCPU)`.
   - `docker stats` with a non-existent container name fails the whole call. The sampler therefore names only live containers and treats a failure as "no samples this tick".
2. **start-command resume** ([`data/start-command-docker-resource-limits.js.txt`](data/start-command-docker-resource-limits.js.txt), lines 94–96): on `--resume`, start-command reads `HostConfig.NanoCpus` and passes it back as `--cpus`. A container that is penalized at resume time comes back with the 2-CPU cap. Hive Mind handles this: when it first sees a container whose `NanoCpus` is already below capacity, it starts that session in the penalized phase, so the cap is lifted later.
3. **End to end** ([`data/penalty-e2e.log`](data/penalty-e2e.log)): `runDockerCpuPenaltyPass` drove a live `alpine` container with 20 s windows. It applied `--cpus 2` after 20 s busy, and lifted the cap to 6 CPUs (`NanoCpus=6000000000`) after 20 s idle. The host was shared with other load (load average 7–24 on 6 CPUs), so the burner got only about 1.5–2.7 cores. The run therefore used `TRIGGER=20%`; the state machine itself does not change with the threshold.

## 5. Solutions per requirement

| #   | Options considered                                                                                                  | Chosen                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | (a) `docker stats` per tick; (b) read `cpu.stat` from the cgroup filesystem; (c) PSI                                | (a): one `docker stats --no-stream` call per 30 s monitor tick for all Docker sessions, giving a rolling, timestamp-based 15-minute average. (b) needs host cgroup paths; (c) is not per container.                                                                                        |
| R2  | (a) `docker update --cpus 2`; (b) `--cpu-shares` (weight); (c) restart the container with a new limit; (d) cpulimit | (a): a hard, live cap with no restart. A weight only matters under contention, and the issue asks for a hard "2 CPUs".                                                                                                                                                                     |
| R3  | Fixed window vs. credit-style decay                                                                                 | Fixed window as requested: lift once the covered 15-minute average is below `65% × cap`.                                                                                                                                                                                                   |
| R4  | Keep old samples vs. reset                                                                                          | Reset samples and the phase start on every transition. The next trigger needs a full fresh window.                                                                                                                                                                                         |
| R5  | `os.cpus()` of the bot vs. the Docker daemon's `NCPU`                                                               | `docker info --format '{{.NCPU}}'`, cached for 5 minutes, with a fallback to `os.availableParallelism()`. It follows the daemon's machine, also when the VM is resized.                                                                                                                    |
| R6  | Hard-coded vs. CLI/env                                                                                              | `--container-cpu-penalty[-cpus/-trigger/-trigger-window/-release/-release-window]` and the matching `TELEGRAM_CONTAINER_CPU_PENALTY_*` variables. They are validated at startup, and an invalid value stops the bot with a clear error.                                                    |
| R7  | Inside start-command vs. in the Hive Mind session monitor                                                           | In the Hive Mind session monitor (`src/session-monitor.lib.mjs` → `src/docker-cpu-penalty.lib.mjs`). It already polls every Docker task every 30 s and persists session state. On by default for `--isolation docker`, off for screen/tmux.                                                |
| R8  | —                                                                                                                   | start-command has no such feature (no launch-time `--cpus` either). A design was reported as start#189: an opt-in `--cpu-penalty` family of options, owned by its detached completion watcher. It covers `--resume` re-applying the cap, `docker stats` failure modes, and a status field. |
| R9  | —                                                                                                                   | The PR description states that, per the issue, execution pauses until start#189 is delivered. The Hive Mind side does not depend on it. Once start-command ships the feature, Hive Mind can either delegate to it or keep its own monitor.                                                 |
| R10 | —                                                                                                                   | This document, the `data/` folder and the `experiments/` scripts.                                                                                                                                                                                                                          |

### Implementation summary

- `src/docker-cpu-penalty.lib.mjs` holds the pure state machine (`evaluateDockerCpuPenalty`, `commitDockerCpuPenaltyAction`), the Docker I/O (`sampleDockerContainersCpu`, `getDockerHostCpus`, `updateDockerContainerCpus`, `inspectDockerContainerCpus`), and one pass over the active sessions (`runDockerCpuPenaltyPass`).
- `src/session-monitor.lib.mjs` runs one pass per tick, concurrently with the existing session checks and never overlapping a previous pass. It persists `cpuPenalty` state through `session-store` and adds a `🐢 CPU penalty` section to the completion message.
- The phases are `observing → penalized → observing`. Transitions are logged as `cpu_penalty_applied` / `cpu_penalty_lifted` session events. A failed `docker update` is retried on the next tick and logged once per distinct error.
- Tests: `tests/test-issue-2801-docker-cpu-penalty.mjs` (17 tests) and `tests/test-telegram-config.mjs`. They cover the trigger at exactly 15 minutes but not at 14, the release at 1.29 vs. 1.31 cores, the re-trigger only after a fresh window, the dynamic host CPU count, the base `--container-cpu`, inherited caps, update failures, persistence, and the monitor integration.

## 6. Limitations and open questions

- **Host saturation by several tasks.** Three tasks at 2 cores each saturate a 6-CPU host, but none of them uses "all CPUs", so none is penalized. This matches the issue ("if any task uses all 100%"). A host-level policy, for example one gated on PSI `cpu.pressure`, would be a separate feature.
- **Resume with a base limit.** When a task has its own `--container-cpu`, start-command re-applies that base value on `--resume`, which removes an active penalty early. The monitor then observes the task again from scratch. This is acceptable: the task gets a fresh window, not unlimited CPU.
- **Monitor interval.** The 30 s session-monitor tick gives about 30 samples per window. A missed tick only shrinks the sample count; coverage is checked by timestamps.
- **Contended hosts.** As the e2e run shows, a burner on a busy host may not reach 95% of the host CPUs, so it is not penalized. That is the intended per-task semantics: it is not using all CPUs.

## 7. Sources

- Docker CLI, `docker container update`: https://docs.docker.com/reference/cli/docker/container/update/
- Docker CLI, `docker container stats`: https://docs.docker.com/reference/cli/docker/container/stats/
- Docker Engine API, container stats (CPU % formula): https://bump.sh/christophedujarric/hub/docker/doc/docker-engine-api/explorer/operation/operation-containerstats
- Docker forums, computing CPU %: https://forums.docker.com/t/calculate-cpu-usage-in-percentage-with-latest-api/66769
- moby/moby#13627 (`docker stats` CPU % calculation): https://github.com/moby/moby/pull/13627
- Linux kernel, Control Group v2 (`cpu.max`, `cpu.stat`): https://docs.kernel.org/admin-guide/cgroup-v2.html
- Linux kernel, Pressure Stall Information: https://docs.kernel.org/accounting/psi.html
- PSI by example: https://unixism.net/2019/08/linux-pressure-stall-information-psi-by-example
- systemd resource control (`CPUQuota=`, `CPUWeight=`): https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html
- systemd-oomd: https://www.freedesktop.org/software/systemd/man/latest/systemd-oomd.service.html
- Ananicy: https://github.com/Nefelim4ag/Ananicy
- cpulimit: https://github.com/opsengine/cpulimit
- Kubernetes CFS throttling: https://github.com/kubernetes/kubernetes/issues/51135
- Kubernetes CPU throttling and latency: https://cloudoptimo.com/blog/kubernetes-cpu-throttling-cfs-quotas-and-latency-fixes/
- Throttling at low utilisation: https://jorijn.com/en/knowledge-base/kubernetes/monitoring/kubernetes-cpu-throttling-pods-stall-low-utilisation/
- AWS T3 burstable instances: https://aws.amazon.com/ec2/instance-types/t3/
- start-command: https://github.com/link-foundation/start, feature request https://github.com/link-foundation/start/issues/189
