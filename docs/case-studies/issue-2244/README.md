# Case Study: Docker Task Start Failure (Issue #2244)

## Executive summary

[Issue #2244](https://github.com/link-assistant/hive-mind/issues/2244)
reported a Docker-in-Docker (DinD) task that printed only the daemon startup
banner and then exited with code 137. The preserved log proves that the task
container received `SIGKILL` 5.563 seconds after it started. It does **not**
preserve the host evidence needed to identify who sent that signal. Docker
reported `OOMKilled=false`, which means its container state did not record an
engine-observed OOM event; it does not rule out every host- or
orchestrator-level memory failure.

Replaying the immutable incident image uncovered a second, deterministic defect
in the same launch phase. Hive Mind synchronously ran `docker inspect --size`
to establish the task's writable-layer baseline before releasing its child
start gate. On this 19.7 GB DinD image with `fuse-overlayfs`, the size request
remained blocked while ordinary inspect and log requests stayed responsive. The
exact image otherwise completed normally. An optional disk metric could
therefore hold the parent launch lifecycle open indefinitely.

The change in PR #2245:

- gives the writable-layer probe a 10-second deadline, safely below the child's
  30-second fallback gate;
- keeps the probe best-effort and releases the gate even when it times out;
- sends the DinD daemon log to the retained task log only when Hive Mind or the
  task is run with `--verbose`; and
- adds unit and exact-image regression coverage plus a reusable reproduction
  harness.

The `docker inspect --size` hang was reported upstream as
[moby/moby#53641](https://github.com/moby/moby/issues/53641), including the
reproducer, workaround, and a suggested daemon/API fix. The original SIGKILL's
sender remains unknown; the new opt-in diagnostics are intended to distinguish
a daemon bootstrap failure from an external kill if it recurs.

## Scope and requirements

The issue asks for more than a code patch. This table maps every explicit
requirement to its result.

| Requirement                                                | Result                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Download all related logs and data                         | The original gist log, issue/PR metadata and comments, authenticated screenshot, relevant merged PR metadata, exact released sources, image manifest, reproduction outputs, and upstream report are under [`evidence/`](evidence/). [`MANIFEST.md`](MANIFEST.md) describes provenance. |
| Compile data under `docs/case-studies/issue-2244`          | This document, the manifest, checksums, and all immutable investigation artifacts live in this directory.                                                                                                                                                                              |
| Search online for facts and existing solutions             | Primary Docker, Node.js, Bash, Linux signal, and cgroup documentation is cited below. Related Hive Mind changes and exact dependency sources were inspected.                                                                                                                           |
| Reconstruct the timeline                                   | The evidence-backed UTC timeline is below. It distinguishes actual execution time from a status record reconciled four days later.                                                                                                                                                     |
| List every requirement and find each problem's cause       | This table and the findings section cover the external SIGKILL, unbounded size probe, and diagnostic gap separately. Confidence and missing evidence are stated.                                                                                                                       |
| Propose solutions and plans, including existing components | The solution matrix compares the implemented standard-library timeout and existing Box logging switch with alternatives.                                                                                                                                                               |
| Add diagnostics when root cause data is insufficient       | Existing quiet behavior is unchanged. Verbose launches now set Box's existing `DIND_LOG_FILE=/dev/stderr`, retaining dockerd startup output in the task log. Both outer verbose mode and the task's `--verbose` argument enable it.                                                    |
| Report related external-project defects                    | The reproducible size hang was reported to Moby in [#53641](https://github.com/moby/moby/issues/53641). The submitted body and API response are archived.                                                                                                                              |
| Apply the fix across the codebase                          | All production `SizeRw` sampling routes through `getDockerContainerWritableLayerSize`; both startup and session-monitor callers receive the deadline. The shared DinD argument builder covers all privileged DinD launches.                                                            |
| Plan and execute in one PR                                 | Code, tests, changeset, experiment, evidence, and this analysis are all in [PR #2245](https://github.com/link-assistant/hive-mind/pull/2245).                                                                                                                                          |

## Preserved incident

### Identifiers and environment

| Field                    | Preserved value                                                    |
| ------------------------ | ------------------------------------------------------------------ |
| Execution ID             | `9f3e8af1-0fc5-4c19-9cc7-277bd592b345`                             |
| Session ID               | `6eeae339-4797-4b1f-be7c-81bf103d7270`                             |
| Container ID             | `078ba6c799e04800836f7be6e201ba716717d756762e7ffb7fc7c469a4c6a457` |
| Image                    | `konard/hive-mind-dind:2.22.0`                                     |
| Hive Mind release commit | `412e00da227d51dfb2b21a568914f380cf4d0047`                         |
| Node.js                  | `v24.3.0`                                                          |
| Isolation                | detached native Docker, privileged                                 |
| Result                   | exit 137, `signal (SIGKILL)`, `OOMKilled=false`                    |

The command first waited for a per-session gate for up to 300 intervals of 0.1
seconds, then would execute `solve` for
`link-foundation/gh-manager#4`. Its arguments included `--verbose`. No `solve`
output exists, so the failure occurred before the workload reached that command.

### Timeline (UTC)

| Time                         | Event                                                                                                                     | Evidence and interpretation                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-07 00:52:24          | Hive Mind v2.22.0 commit created.                                                                                         | Local tag metadata and the archived release source establish the code in the incident image.                                                          |
| 2026-09-09 17:43:01.481      | start-command records the execution and begins the detached task container.                                               | [`task-start.log`](evidence/task-start.log) is the primary timestamp. The status record rounds this to `17:43:01.492`.                                |
| Immediately after launch     | The only child output is `[dind-entrypoint] Starting dockerd (storage-driver=fuse-overlayfs, data-root=/var/lib/docker)`. | Box writes subsequent daemon output to `/var/log/dockerd.log` by default, so the outer log is silent during bootstrap.                                |
| 2026-09-09 17:43:07.044      | start-command records exit 137 and retains the failed container.                                                          | Runtime from primary timestamps: 5.563 seconds. Bash documents fatal-signal status as `128 + signal`; 137 therefore maps to signal 9, `SIGKILL`.      |
| 2026-09-13 17:40:26.979      | `$ --status` records an `endTime`.                                                                                        | This is 3 days, 23 hours, 57 minutes after the log's authoritative finish time. It is a late observation/reconciliation timestamp, not task duration. |
| 2026-09-13 17:40:47          | Issue #2244 is created with the status, gist, and screenshot.                                                             | Archived issue metadata.                                                                                                                              |
| 2026-09-13 18:27:31–18:28:27 | Exact-image reproduction suite runs.                                                                                      | [`summary.json`](evidence/reproduction/summary.json) and the per-container inspect/log files record all four experiments.                             |

## Findings and root causes

### 1. Reported terminal mechanism: external SIGKILL

This finding is conclusive at the mechanism level:

- the process exited 137;
- start-command decoded the exit reason as `signal (SIGKILL)`;
- the Docker state said `OOMKilled=false`; and
- the task ended during DinD bootstrap, before its gated workload ran.

`SIGKILL` cannot be caught, blocked, or ignored. The container itself therefore
could not add a final diagnostic after receiving it. Neither the exact Box
2.4.0 entrypoint nor start-command 0.33.0 contains a normal path that kills a
fresh task at approximately 5.6 seconds. The exact image also starts and exits
successfully in the same privileged/fuse-overlayfs configuration.

The experiment deliberately sent `docker kill --signal KILL` at 5.6 seconds.
It produced exit 137, `OOMKilled=false`, an empty Docker state error, and a
6.261-second lifetime—the same observable signature as the incident. This is a
state-signature reproduction, not proof that a particular operator or service
sent the original signal.

**Unknown:** the original host's Docker events, daemon journal, kernel log,
cgroup memory events, complete container inspect record, and
`/var/log/dockerd.log` were not attached and the reported container no longer
exists. Those are the records that could distinguish an operator command,
service restart, host OOM, cgroup policy, or another orchestrator. Assigning one
of those causes would exceed the evidence.

`OOMKilled=false` is deliberately treated narrowly. Moby sets the container OOM
state in response to its OOM event path, while Linux exposes `oom` and
`oom_kill` counters through cgroup v2 `memory.events`. Absence of Docker's flag
is evidence against an engine-observed container OOM, but not proof that every
host-level memory failure was absent.

### 2. Confirmed orchestration defect: unbounded writable-layer walk

PR #1989 added a launch-time disk baseline using:

```text
docker inspect --size -f {{.SizeRw}} <session-id>
```

The parent awaited that optional call before attaching sidecar networks and
entering the `finally` block that releases the child gate. The child had a
30-second fallback, so it could eventually begin its command, but the Hive Mind
launch lifecycle remained stuck on the unresolved size process. There was no
timeout or cancellation.

Against the immutable amd64 image digest used for this investigation:

- a normal gated container completed successfully with exit 0 in 15.949
  seconds;
- ordinary `docker inspect`, `docker logs`, and `docker exec` remained usable;
- the separate `docker inspect --size` client still had not completed after the
  10-second observation window and had to be terminated by the harness; and
- the production fixed helper returned `null` after 10.028 seconds, logged the
  timeout in verbose mode, released the gate, and the child exited 0.

Docker documents that `inspect --size` adds `SizeRw` and `SizeRootFs`, which
requires storage-driver-specific size work. Moby's Engine API likewise makes
container size an optional `size=true` calculation. The exact internal Moby
blocking point was not established, so the project-level report asks Moby to
make the API request cancellable or bound the storage-driver walk rather than
asserting a speculative daemon root cause.

This defect does not explain why the original child received SIGKILL after
5.563 seconds. It is a distinct, reproducible defect on the same launch path
and can independently make a task appear stuck in “starting.”

### 3. Diagnostic gap: daemon output was stranded inside the container

The Box 2.4.0 DinD entrypoint logs one startup banner to stderr and redirects
dockerd itself to `DIND_LOG_FILE`, defaulting to `/var/log/dockerd.log`. The
original retained-session log therefore contains the banner but none of the
daemon's startup decisions or errors. By the time this investigation began,
the retained container and its internal log were unavailable.

Box already provides the correct opt-in component: setting
`DIND_LOG_FILE=/dev/stderr`. The launch builder now applies that setting only
when either Hive Mind verbose mode or the task's `--verbose` argument is active.
The exact-image verbose experiment captured 111 console lines including dockerd
output, while quiet behavior stayed unchanged. This does not reveal who sends
a future uncatchable SIGKILL, but it will establish whether daemon bootstrap
was healthy up to the kill.

## Solution design

| Problem                                       | Implemented solution                                                                                           | Existing component used                                                                    | Why this choice                                                                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Optional `SizeRw` walk can block forever      | Execute the Docker CLI directly with a 10,000 ms timeout and a 4 KiB output cap; return `null` on any failure. | Node.js `child_process.execFile` and `util.promisify`                                      | No shell interpolation or new dependency; Node supplies process timeout and buffer enforcement. The metric was already best-effort.  |
| Start gate depends on the metric              | Keep the size call inside the existing `try/finally`, with its deadline below the 30-second child fallback.    | Existing Hive Mind gate release                                                            | Preserves pre-workload baseline ordering without allowing an optional observation to own task liveness.                              |
| DinD daemon log disappears with the container | In verbose mode, set `DIND_LOG_FILE=/dev/stderr`.                                                              | Existing Box entrypoint switch                                                             | Captures diagnostics in the already-retained start-command log; no Box fork or quiet-log noise.                                      |
| Original SIGKILL sender is unknown            | Preserve confidence boundaries and document the host artifacts needed on recurrence.                           | Existing start-command failed-container retention and Hive Mind killed-session diagnostics | Automatic retry cannot identify a kill source and may duplicate task side effects. Better evidence is required before adding policy. |

### Alternatives considered

- **Remove writable-layer measurements:** avoids the hang but regresses the
  task-scoped disk accounting added for issues #1999–#2001. A bounded
  best-effort measurement preserves the feature.
- **Increase the child gate timeout:** only moves the visible symptom and leaves
  the parent blocked. The optional operation itself needs a deadline.
- **Add a Docker SDK:** would add dependency and transport surface, while an API
  client deadline still cannot guarantee that the daemon cancels its internal
  size calculation. The Docker CLI is already a runtime prerequisite.
- **Always stream dockerd:** provides more data but substantially expands normal
  task logs. The reported invocation already requested `--verbose`, making an
  opt-in switch the least surprising behavior.
- **Automatically restart every exit 137:** unsafe because 137 has multiple
  causes and the workload may have side effects. Existing killed-session
  diagnosis and bounded resume mechanisms remain the correct recovery layer.
- **Force a different storage driver:** deployment-specific and potentially
  incompatible. The caller must remain robust even when a daemon/storage driver
  cannot calculate size promptly.

## Codebase-wide audit

Production searches for `SizeRw`, `inspect --size`, and the shared helper found:

1. launch-time sampling in `executeWithIsolation`;
2. periodic/completion sampling in `session-monitor.lib.mjs`; and
3. the single shared `getDockerContainerWritableLayerSize` implementation.

Putting the timeout in the shared implementation protects every production
caller, including monitor sampling after startup. The only DinD launch argument
construction flows through `buildDockerIsolationStartArgs`, so its diagnostic
environment change applies consistently to all privileged DinD task launches.
No second unbounded production implementation was found.

## Reproduction and verification

The reusable harness is
[`experiments/issue-2244-reproduce-dind-startup.sh`](../../../experiments/issue-2244-reproduce-dind-startup.sh).
It pins the incident image by digest and creates four short-lived containers:

1. a normal gated launch with an observed pre-fix size request;
2. a launch using the fixed production helper;
3. a deliberate 5.6-second SIGKILL signature comparison; and
4. an opt-in verbose logging run.

The harness records console output, the internal dockerd log when present, full
Docker inspect state, probe output, and a machine-readable summary. A trap
removes all four named test containers after capture.

The automated regression test was committed before the implementation and
initially failed because the finite-timeout contract did not exist. It now
checks:

- the exact Docker CLI arguments and finite timeout;
- the production timeout is below the child gate;
- a timeout is non-fatal and observable;
- malformed size output remains best-effort; and
- daemon logs are enabled for outer or task-level verbose mode, never by
  default.

Related Docker isolation suites cover the existing argument builder, native
Docker backend, size parsing, and launch behavior.

## Evidence required if SIGKILL recurs

Before removing the failed container or restarting the host, retain:

```bash
docker inspect <container> > container-inspect.json
docker events --since <start-time> --until <finish-time> > docker-events.log
docker cp <container>:/var/log/dockerd.log dockerd.log
journalctl -u docker --since <start-time> --until <finish-time> > docker-journal.log
journalctl -k --since <start-time> --until <finish-time> > kernel.log
```

On cgroup v2, also resolve the container's actual cgroup and preserve its
`memory.events` file. Record host/container memory limits and the supervising
service journal. The new verbose switch should already put dockerd output in the
start-command log, but these host-side records are still necessary to identify
an external `SIGKILL` sender.

## External references

- [Docker CLI: `docker inspect`](https://docs.docker.com/reference/cli/docker/inspect/)
  documents the `--size` option and the additional size fields.
- [Docker Engine API v1.46](https://docs.docker.com/reference/api/engine/version/v1.46/)
  documents the optional `size` query for container inspection.
- [Node.js `child_process`](https://nodejs.org/api/child_process.html)
  documents `execFile`, `timeout`, `killSignal`, and `maxBuffer`.
- [GNU Bash exit status](https://www.gnu.org/software/bash/manual/html_node/Exit-Status.html)
  documents `128 + N` for a command terminated by fatal signal N.
- [Linux `signal(7)`](https://man7.org/linux/man-pages/man7/signal.7.html)
  identifies SIGKILL as signal 9 and states that it cannot be caught, blocked,
  or ignored.
- [Linux cgroup v2](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html)
  documents `memory.events`, including `oom` and `oom_kill` counters.
- [Moby daemon monitor source](https://github.com/moby/moby/blob/master/daemon/monitor.go)
  shows Docker setting its OOM-killed state on the daemon's OOM event path.

## Conclusion

The original task did not merely “fail to start”: it was externally killed
during DinD bootstrap, and the surviving evidence cannot name the sender. The
investigation nevertheless found and reproduced an independent unbounded
operation in the same startup path. Bounding that optional metric restores
launch liveness, while the default-off DinD log streaming makes the next early
failure materially diagnosable. The implementation avoids inventing an OOM
story from exit 137 and avoids unsafe unconditional retries.
