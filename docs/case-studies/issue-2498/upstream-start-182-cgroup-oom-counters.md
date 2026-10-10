## Problem

Docker's `State.OOMKilled` is container-wide and sticky (moby/moby#43564). It says _that_ some process in the container was OOM-killed at some point, but not:

1. **how many** processes were killed (one OOM event often kills several: in link-foundation/meta-language#196 three `formal-ai-corpus-memory` children were each `Killed` with exit 137 within one `bash` loop);
2. whether the container hit **its own** `--memory` limit or the whole **host** ran out of memory and the global OOM killer picked a process in this container;
3. how close the execution came to its limit (peak usage).

The kernel already keeps all three per cgroup in [cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files):

- `memory.events` `oom` — the cgroup hit its own limit and allocation failed;
- `memory.events` `oom_kill` — processes in the cgroup killed by **any** OOM killer, so `oom_kill > oom` points to a host-wide OOM;
- `memory.peak` / `memory.max` — peak usage and limit.

The cgroup is removed when the container stops, so these values cannot be read afterwards with `docker inspect`. `$ --status` therefore has nothing to report today, and callers fall back to the sticky flag. That is how #180 happened.

## Proposal

While a detached Docker execution runs, have the watcher sample the container's cgroup (`/sys/fs/cgroup/system.slice/docker-<id>.scope/` or the path from `docker inspect` `.HostConfig.CgroupParent`). It already polls the container. Store the last values in the execution record, and report them in `--status` and the post-mortem:

```
cgroupMemory: { limitBytes, peakBytes, oomEvents, oomKills }
```

With these values `memoryExhausted` can also be decided properly (#180): `oomKills > 0` combined with a main-process exit of 137 means the main process was a casualty. `oomKills > 0` with exit 0/1 means only children were killed.

## Context

hive-mind now records the same counters from _inside_ the task (link-assistant/hive-mind#2498, PR #2499), but that only works while solve is alive to write a snapshot. The watcher is the one component that sees the whole lifetime of the container.

## Environment

start-command 0.35.1 (JS), Docker isolation, cgroup v2 host.
