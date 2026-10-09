## Summary

Add an **optional, delayed CPU penalty** for `$ --isolated docker` containers. When a container keeps all of its CPUs busy for a whole trigger window, cap it to a few CPUs with `docker update --cpus`. Lift the cap once it has stayed quiet for a whole release window.

Requested by [link-assistant/hive-mind#2801](https://github.com/link-assistant/hive-mind/issues/2801). Hive Mind enables this by default for its Docker tasks; for `start` it should be **opt-in**. Until `start` supports it, Hive Mind ships its own implementation in its session monitor ([link-assistant/hive-mind#2802](https://github.com/link-assistant/hive-mind/pull/2802)). Once `start` has it, Hive Mind would forward its settings to `$` and keep its own monitor only as a fallback for older `start` versions.

## Behaviour

> If any task uses all 100% of virtual machine CPUs for more than 15 minutes it should be restricted to 2 CPUs per docker container until for at least 15 minutes average CPU usage is below 65% of total CPU cores [...] from that moment we monitor for next 15 minutes, if again usage is more than total machine cores [...] for at least 15 minutes the task again will be restricted.

1. **Observing.** Sample the container's CPU usage (100% = one core). If its average over the last `trigger-window` is at least `trigger`% of the CPUs it may use, apply `docker update --cpus <penalty-cpus>`. The CPUs it may use are `docker info .NCPU`, re-read regularly because a VM can be resized, or its own `--cpus` limit when that is lower.
2. **Penalized.** Once the cap has been in place for at least `release-window` and the average over that window is below `release`% of the cap (65% of 2 CPUs = 1.3 cores), restore the base limit.
3. After a lift, observation starts from scratch: the full trigger window has to pass again before another penalty.

Skip the penalty when `penalty-cpus` is not below the container's own capacity. A 15-minute average only counts when samples cover the whole window. Samples lost during a watcher restart or a `docker stats` outage must not be treated as busy.

## Proposed CLI (mirrors Hive Mind's `--container-cpu-penalty*` options)

| Option                             | Default when enabled | Meaning                                                 |
| ---------------------------------- | -------------------- | ------------------------------------------------------- |
| `--cpu-penalty`                    | off                  | Enable the penalty (docker isolation only)              |
| `--cpu-penalty-cpus <n>`           | `2`                  | Cap applied to a penalized container                    |
| `--cpu-penalty-trigger <p%>`       | `95%`                | Share of the container's CPUs that counts as "all CPUs" |
| `--cpu-penalty-trigger-window <d>` | `15m`                | How long the trigger average must hold                  |
| `--cpu-penalty-release <p%>`       | `65%`                | Share of the cap to stay below for a lift               |
| `--cpu-penalty-release-window <d>` | `15m`                | How long the release average must hold                  |

Durations accept `ms`/`s`/`m`/`h`. Hive Mind needs two more things:

- **`$ --status` reports the state**, for example `cpuPenalty: { phase: 'penalized', since, limitCpus: 2, baseCpus: null, penaltyCount: 1, penalizedMs }`, so a bot can show it in its completion message.
- **One log line per transition**, for example `[start] CPU penalty applied: 2 CPUs (5.9 of 6 CPUs for 15m)` and `[start] CPU penalty lifted: 6 CPUs (0.4 CPUs for 15m)`.

## Docker facts the implementation needs (verified on Docker 28, cgroup v2)

- `docker update --cpus 0` exits 0 **but keeps the old cap**. It cannot lift a penalty.
- `docker update --cpu-quota -1` lifts the cgroup cap but leaves the old `HostConfig.NanoCpus` behind.
- `docker update --cpus <NCPU>` lifts cleanly (`cpu.max 600000 100000` on a 6-CPU host). Values above NCPU are rejected (`range of CPUs is from 0.01 to 6.00`).
- `docker stats --no-stream <a> <b>` fails as a whole, with exit 1 and no output, as soon as one named container is gone. Sample all running containers and filter.
- **Interaction with `--resume` (issue #176):** `readDockerResourceLimits` copies `HostConfig.NanoCpus` into the resumed container. A container resumed while penalized therefore inherits the 2-CPU cap as if it were the base limit. The watcher should remember the base limit at launch, re-apply that on resume, and either continue the penalty phase or start observing afresh.

Experiment scripts and logs: https://github.com/link-assistant/hive-mind/tree/issue-2801-f9bf1f787e57/experiments (`issue-2801-*`).

## Suggested implementation

The detached completion watcher already outlives the CLI, so it is the natural owner. It could run a small sampling loop next to `docker logs -f`, for example every 30 s, using `docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}'` or the container's `cpu.stat` `usage_usec` delta. The window averages are timestamp-based, so the sampling interval does not change the semantics. Hive Mind's state machine is pure and could be ported directly: https://github.com/link-assistant/hive-mind/blob/issue-2801-f9bf1f787e57/src/docker-cpu-penalty.lib.mjs (`evaluateDockerCpuPenalty`).
