# Online research: issue #2803 (Claude exit code 137 / OOM kill inside a Docker container)

Context: Claude Code ran inside a docker-in-docker container on a cgroup v2 host. The container
memory limit was 2.9 GB (25% of an 11.7 GB host), set with `docker update --memory`. While
`cargo test -j 2` was running, the kernel OOM killer SIGKILLed the CLI. The run ended with
`Claude command failed with exit code 137` and nothing recovered automatically.

Sources were collected on 2026-10-08. Numbers in brackets refer to the References section.

---

## 1. Exit code 137 and cgroup v2 memory accounting

### 1.1 Why 137

- When a process dies from a signal, shells and Docker report the exit status as `128 + signal`.
  `SIGKILL` is signal 9, so the status is `128 + 9 = 137` [13].
- Exit code 137 alone does not prove an OOM kill. An operator can send `SIGKILL` by hand
  (`kill -9`, `docker kill`), and so can a runtime whose stop grace period ran out. A user-space
  OOM daemon (earlyoom, systemd-oomd) also produces 137 [13][14]. To confirm an OOM kill you
  need a second signal: `dmesg`/journal lines such as `Memory cgroup out of memory: Killed process ...`,
  the cgroup's `memory.events`, or Docker's `State.OOMKilled`.

### 1.2 cgroup v2 interface files (kernel admin guide [1])

| File                            | Meaning (quoted or close paraphrase from [1])                                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memory.max`                    | "Memory usage hard limit." If usage hits it and reclaim cannot bring it down, "the OOM killer is invoked in the cgroup." Docker's `--memory` writes this file. |
| `memory.high`                   | "Memory usage throttle limit." Above it, processes "are throttled and put under heavy reclaim pressure", but they are **not** OOM-killed.                      |
| `memory.peak`                   | "The max memory usage recorded for the cgroup and its descendants" since creation (or since the last reset through that FD).                                   |
| `memory.oom.group`              | Treats the cgroup "as an indivisible workload": all tasks "are killed together or not at all".                                                                 |
| `memory.swap.max`               | Swap hard limit.                                                                                                                                               |
| `memory.events: high`           | Number of times processes were throttled and pushed into direct reclaim because `memory.high` was exceeded.                                                    |
| `memory.events: max`            | Number of times usage "was about to go over the max boundary". If direct reclaim fails, the cgroup goes to OOM state.                                          |
| `memory.events: oom`            | Number of times usage reached the limit and "allocation was about to fail".                                                                                    |
| `memory.events: oom_kill`       | "The number of processes belonging to this cgroup killed by any kind of OOM killer."                                                                           |
| `memory.events: oom_group_kill` | "The number of times a group OOM has occurred."                                                                                                                |

What this means for #2803:

- A watchdog can read `/sys/fs/cgroup/memory.events` before and after a run (this is the
  container's own cgroup under cgroup namespaces). If `oom_kill` went up, the exit-137 was caused
  by memory pressure and not by an external kill. `memory.events.local` holds the same counters
  for this cgroup only, without descendants [1].
- Reading `memory.peak` together with `memory.max` shows how close the run got to the limit.
- `memory.oom.group` is off by default. So the kernel picks a single victim, the task with the
  highest `oom_score` (roughly its RSS). A Node.js CLI holding a large heap can be chosen ahead of
  the `rustc`/test processes that actually caused the spike.

---

## 2. Docker semantics

### 2.1 `State.OOMKilled` is not only about PID 1

- moby issue #18510 [2] reproduced four cases: init OOMs, child OOMs, exec process OOMs while init
  does too, and exec OOMs while init does not. Before the regression introduced by #16235, Docker
  returned `OOMKilled=true` in **all four**, including `exit 0 - true`, where a child was killed but
  the container exited normally.
- PR #18512 "Set OOMKilled state on any OOM event" [3] (merged 2016-01-10) restored that behavior.
  The author explains that telling apart "the init process OOMed" from "some process OOMed"
  "would probably be a heuristic at best", because the kernel's cgroup OOM notification carries
  no PID.
- PR #43564 [4] (merged 2022-08-25, by corhere) changed when the flag is set. Changelog text:
  "A container's `State.OOMKilled` flag is now set to true immediately upon any container process
  getting OOM-killed by the kernel, and cleared to false when the container is restarted."
- Conclusion: `OOMKilled=true` means some process in the container's cgroup was OOM-killed since
  the last start. In a long-lived docker-in-docker "worker" container, `OOMKilled` can be true
  while the container keeps running. That is exactly the situation in #2803, where the CLI died
  but the container stayed up.

### 2.2 `docker run` memory flags [5]

- `--memory/-m`: the hard limit (cgroup v2 `memory.max`).
- `--memory-swap`: **memory + swap** total. If unset, the container may use swap equal to
  `--memory` (when the host has swap). If equal to `--memory`, there is no swap. `-1` means
  unlimited swap. Example: `--memory=300m --memory-swap=1g` gives 700m of swap.
- `--memory-reservation`: soft limit, enforced only under host memory contention. It must be
  lower than `--memory`, and it "doesn't guarantee that the container doesn't exceed the limit".
  On cgroup v2 it maps to `memory.low`.
- `--oom-kill-disable`: Docker warns to use it only together with `-m`, and warns against using it
  to bypass OOM safeguards [5]. cgroup v2 has no equivalent of v1's `memory.oom_control`. On v2
  hosts the daemon drops the option with the warning "Your kernel does not support
  OomKillDisable, OomKillDisable discarded" [6]. It is therefore **not** a usable mitigation here.

### 2.3 `docker update` limitations

- `docker update` can change `--memory`, `--memory-swap`, `--memory-reservation` and `--restart`
  on a running container. A new restart policy "takes effect instantly" [7].
- If you raise `--memory` above the swap limit already in place, Docker rejects it with
  "Memory limit should be smaller than already set memoryswap limit, update the memoryswap at
  the same time" (moby PR #25461 [8]). When the container was created with only `-m`, the
  memory+swap total defaults to 2x memory, so raising memory past that requires passing
  `--memory-swap` in the same command (for example `--memory-swap -1` or an explicit value).
- `docker update` is not supported for Windows containers [7].

### 2.4 `docker commit` does not carry HostConfig

- `docker commit --change` accepts only `CMD|ENTRYPOINT|ENV|EXPOSE|LABEL|ONBUILD|USER|VOLUME|WORKDIR`
  [9]. Memory and CPU limits, restart policy, mounts and similar settings are container
  `HostConfig`, not image config, so the committed image does not keep them. A container started
  from a committed image gets no memory limit unless `--memory` is passed again at `docker run`
  time. Data in mounted volumes is also not included [9].

---

## 3. Existing tools and how they handle OOM

| Tool                                 | Mechanism                                                                                                                                                                                                                                                                                                                                               | Relevance                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **earlyoom** [10]                    | User-space daemon that polls available RAM and free swap up to 10x/s. It sends SIGTERM when both drop below `-m`/`-s` (default 10%) and SIGKILL below half of that (default 5%). `--prefer`/`--avoid`/`--ignore` regexes control which processes it picks.                                                                                              | Lets the "real" memory hog (`rustc`, test binaries) be killed instead of the agent CLI, for example `--avoid '^(node\|claude)$' --prefer '^(rustc\|cc1plus\|ld)'`.                              |
| **systemd-oomd** [11]                | Polls PSI (pressure stall information). Units opt in with `ManagedOOMMemoryPressure=` (60% default limit) and `ManagedOOMSwap=`. It SIGKILLs a **whole cgroup**, and only leaf cgroups or cgroups with `memory.oom.group=1` are eligible. Needs the unified hierarchy and Linux 4.20+.                                                                  | Shows that killing at cgroup granularity is the established design. Builds could run in a child cgroup that gets killed instead of the agent.                                                   |
| **nohang** [12]                      | Daemon similar to earlyoom. It supports PSI and zram triggers, desktop notifications, and configurable soft/hard thresholds.                                                                                                                                                                                                                            | Another option for acting on pressure before the OOM killer does.                                                                                                                               |
| **Kubernetes** [15]                  | `restartPolicy` (Always/OnFailure/Never). The kubelet restarts containers "with an exponential backoff delay (10s, 20s, 40s, ...), that is capped at 300 seconds", and resets the timer after 10 minutes of healthy running. Status `CrashLoopBackOff` means the backoff is in effect. The termination reason `OOMKilled` is exposed in the pod status. | Template for automatic restart after an OOM, with backoff.                                                                                                                                      |
| **Vertical Pod Autoscaler** [16][17] | The recommender treats an OOM as a synthetic usage sample of `max(basis + oom-min-bump-up-bytes, basis * oom-bump-up-ratio)`, with defaults `1.2` and `100 MiB` (`1.048576e+08`). Updater flag `evict-after-oom-threshold` defaults to `10m`.                                                                                                           | Precedent for "after an OOM, retry with at least +20% / +100 MiB more memory".                                                                                                                  |
| **Nomad** [18]                       | `resources { memory = <reserve>; memory_max = <ceiling> }`. Memory oversubscription is opt-in. Under contention Nomad pushes tasks back to their reserve and may kill and reschedule them. The docker driver supports it.                                                                                                                               | Soft/hard pair: schedule on the soft value, allow bursts up to the hard value.                                                                                                                  |
| **AWS ECS** [19]                     | `memoryReservation` is the soft limit used for placement. `memory` is the hard limit, and a container that exceeds it is killed.                                                                                                                                                                                                                        | Same soft/hard split. AWS's example: reservation 128 MiB, hard limit 300 MiB for a workload that bursts to 256 MiB.                                                                             |
| **cgroup v2 `memory.high`** [1]      | Throttles and reclaims above the threshold instead of killing.                                                                                                                                                                                                                                                                                          | Setting `memory.high` to about 85-90% of `memory.max` turns a sudden SIGKILL into a slowdown that a watchdog can see (`memory.events: high` rises), with time to react before `max`/`oom_kill`. |

### 3.1 Jitter: why randomize memory percentages and restart delays

AWS Architecture Blog, "Exponential Backoff And Jitter" [20]: with N clients contending, plain
exponential backoff still leaves calls arriving in synchronized clusters. "The solution isn't to
remove backoff. It's to add jitter." Full jitter (`sleep = random(0, min(cap, base * 2^attempt))`)
spreads calls into a roughly constant rate and does the least total work. Decorrelated jitter
completes slightly faster.

Applied to #2803:

- **Random restart delays.** When several solver containers on one host are OOM-killed in the
  same pressure event, restarting them all at the same moment recreates the same peak. Full-jitter
  delays spread the restarts out.
- **Random memory-limit percentages.** For example, give each container a limit drawn from
  20-30% instead of exactly 25%. Containers then reach their limits at different times, so they
  do not all hit OOM in lockstep when they run similar workloads (such as `cargo test`). This
  applies the same desynchronization principle to resource limits.

---

## 4. Reducing memory use of Rust builds and tests

| Knob                                       | Facts                                                                                                                                                                                                                                                                     | Source   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `CARGO_BUILD_JOBS` / `build.jobs` / `-j N` | Maximum number of parallel compiler processes. Defaults to the number of logical CPUs. Negative values mean "CPUs + value". Must not be 0.                                                                                                                                | [21]     |
| `cargo test -j N`                          | Affects **building** the test executables only, "does not affect how many threads are used when running the tests". Use `cargo test -j 1 -- --test-threads=1` to limit both. Test binaries run serially, but doctests run "in parallel in separate processes".            | [22]     |
| `--test-threads` / `RUST_TEST_THREADS`     | libtest runs tests in parallel by default. `RUST_TEST_THREADS` caps the thread count, and `--test-threads` overrides it.                                                                                                                                                  | [23]     |
| `debug = 0` / `"line-tables-only"`         | `dev`/`test` profiles default to `debug = true` (full). `line-tables-only` keeps file:line backtraces only. Turning debuginfo off can speed up dev builds "by as much as 20-40%" and shrinks the objects the linker must hold in memory.                                  | [24][25] |
| `codegen-units`                            | 256 for incremental builds and 16 for non-incremental. `profile.test` inherits from `dev`. More units means more parallel LLVM work (and peak memory) within one `rustc`.                                                                                                 | [24][25] |
| Linker (lld / mold)                        | Since Rust 1.90.0 (2025-09-18), `x86_64-unknown-linux-gnu` links with LLD by default. Opt out with `-C linker-features=-lld`. The perf book says mold is "often faster than lld" but less mature. The linker is often the peak-memory step for large debug test binaries. | [25][26] |

Practical recipe for memory-constrained agents:
`CARGO_BUILD_JOBS=1 RUST_TEST_THREADS=1 CARGO_PROFILE_TEST_DEBUG=line-tables-only cargo test -j 1 -- --test-threads=1`.
Scale `-j` with the _container_ memory limit (`memory.max`), not with `nproc`.

---

## 5. Resuming a SIGKILLed Claude Code session

- Claude Code saves sessions "continuously" as JSONL at
  `~/.claude/projects/<project>/<session-id>.jsonl` [27]. Because the transcript is written as the
  session runs rather than at exit, it survives a SIGKILL of the CLI.
- `claude --resume <session-id>` (or `-r`) resumes by ID, by name, or by the absolute path of the
  `.jsonl` file. It searches the current project and worktrees first, then all projects on the
  machine [27][28]. `claude -p --resume <id> "prompt"` continues non-interactively, which suits
  an automatic retry wrapper. `--fork-session` resumes into a new session ID instead [28].
- Crash behavior is documented [27]: "A tool that was still running when the previous process
  ended, for example in a crash, doesn't finish or run again when you resume. Claude sees the call
  marked as cut off before its result was recorded and is told to check whether it took effect
  before running it again." This is the expected outcome after an OOM kill in the middle of
  `cargo test`.
- Flags such as `--mcp-config`, `--settings`, `--plugin-dir`, `--fallback-model` and `--add-dir` are
  **not** restored and must be passed again on resume. `-p` resumes start in the permission mode a
  fresh `claude -p` run would use, so pass `--dangerously-skip-permissions`/`--permission-mode`
  again [27].
- `--no-session-persistence` or `CLAUDE_CODE_SKIP_PROMPT_HISTORY` turns persistence off and makes
  resume impossible. A recovery path should check that neither is set [27][28].

Recovery pattern that follows from the above: on exit 137, check `memory.events` (`oom_kill`
went up), wait a full-jitter random delay, optionally raise the memory limit by
`max(+20%, +100 MiB)` (as VPA does), and then run `claude -p --resume <session-id> "Your previous
run was OOM-killed during <cmd>; continue with lower parallelism (-j 1, --test-threads=1)."`.

---

## References

1. Linux kernel, Control Group v2 admin guide: https://docs.kernel.org/admin-guide/cgroup-v2.html
2. moby/moby#18510 "Docker 1.9: OOMKilled not reliably set": https://github.com/moby/moby/issues/18510
3. moby/moby#18512 "Set OOMKilled state on any OOM event": https://github.com/moby/moby/pull/18512
4. moby/moby#43564 "Refactor libcontainerd to minimize containerd RPCs" (OOMKilled set immediately on any process): https://github.com/moby/moby/pull/43564
5. Docker docs, Resource constraints: https://docs.docker.com/engine/containers/resource_constraints/
6. moby commit 57f1305 (daemon-side `OomKillDisable discarded` warning; mirror): https://git.causa-arcana.com/kotovalexarian-likes-github/moby--moby/commit/57f1305e749cbf909238b407b3437d5859a747e2
7. Docker CLI reference, `docker container update`: https://docs.docker.com/reference/cli/docker/container/update/
8. moby PR #25461 "Fix update memory without memoryswap" (mirror): https://git.causa-arcana.com/kotovalexarian-likes-github/moby--moby/commit/92394785fa3e55b19402fc762c030d28b36b6cfc
9. Docker CLI reference, `docker container commit`: https://docs.docker.com/reference/cli/docker/container/commit/
10. earlyoom: https://github.com/rfjakob/earlyoom
11. systemd-oomd(8): https://man7.org/linux/man-pages/man8/systemd-oomd.service.8.html
12. nohang: https://github.com/hakavlad/nohang
13. "Exit Code 137: What It Means and How to Fix It": https://odown.com/blog/exit-code-137-what-it-means-and-how-to-fix-it/
14. Netdata, "Docker OOMKilled: causes, detection, and prevention": https://www.netdata.cloud/guides/docker/docker-oomkilled/
15. Kubernetes, Pod lifecycle (restart policy, back-off, CrashLoopBackOff): https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/
16. Kubernetes autoscaler, VPA flags (`oom-bump-up-ratio`, `oom-min-bump-up-bytes`, `evict-after-oom-threshold`): https://github.com/kubernetes/autoscaler/blob/master/vertical-pod-autoscaler/docs/flags.md
17. OneUptime, "How to Account for Startup Spikes and OOM Events in VPA Memory Recommendations": https://oneuptime.com/blog/post/2026-08-25-vpa-startup-spikes-oom-events/markdown
18. Nomad, `resources` block and memory oversubscription: https://developer.hashicorp.com/nomad/docs/job-specification/resources and https://developer.hashicorp.com/nomad/tutorials/advanced-scheduling/memory-oversubscription
19. AWS, allocate memory to ECS tasks (`memory` vs `memoryReservation`): https://repost.aws/knowledge-center/allocate-ecs-memory-tasks and https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html
20. AWS Architecture Blog, "Exponential Backoff And Jitter": https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
21. Cargo Book, configuration (`build.jobs`): https://doc.rust-lang.org/cargo/reference/config.html
22. Cargo Book, `cargo test`: https://doc.rust-lang.org/cargo/commands/cargo-test.html
23. rustc book, Tests (`RUST_TEST_THREADS`, `--test-threads`): https://doc.rust-lang.org/rustc/tests/
24. Cargo Book, Profiles (`debug`, `codegen-units`): https://doc.rust-lang.org/cargo/reference/profiles.html
25. The Rust Performance Book, Build configuration: https://nnethercote.github.io/perf-book/build-configuration.html
26. Rust blog, "Faster linking times with 1.90.0 stable on Linux using the LLD linker": https://blog.rust-lang.org/2025/09/01/rust-lld-on-1.90.0-stable and Rust 1.90.0 release: https://blog.rust-lang.org/2025/09/18/Rust-1.90.0/
27. Claude Code docs, Manage sessions: https://code.claude.com/docs/en/sessions
28. Claude Code docs, CLI reference: https://code.claude.com/docs/en/cli-reference
