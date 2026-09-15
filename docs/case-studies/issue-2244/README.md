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
- makes the start gate narrate itself, so a log written during startup says
  whether the task command had begun;
- streams the DinD daemon log into the retained task log **by default**, with
  `HIVE_MIND_DIND_DAEMON_LOG=0` as the per-deployment opt-out;
- snapshots the task container to the host (`docker inspect`, `docker logs`,
  the nested `dockerd.log`) **before** the retention policy removes it, and
  quotes the decoded signal and `OOMKilled` in the completion notification; and
- adds unit, shell-level, and exact-image regression coverage plus reusable
  reproduction and verification harnesses.

Three upstream defects were reported with reproducers, workarounds, and
code-level fix suggestions:
[moby/moby#53641](https://github.com/moby/moby/issues/53641) for the
`docker inspect --size` hang, and
[link-foundation/start#170](https://github.com/link-foundation/start/issues/170)
and [#171](https://github.com/link-foundation/start/issues/171) for the two
reasons the preserved session record could not describe its own ending.

The original SIGKILL's sender remains unknown, and the spontaneous kill itself
was **not** reproduced — see
[Reproduction and verification](#reproduction-and-verification) for exactly what
was and was not reproduced. The new default diagnostics are designed so that a
recurrence arrives with the evidence this one lacked.

## Scope and requirements

The issue asks for more than a code patch. This table maps every explicit
requirement to its result.

| Requirement                                                | Result                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Download all related logs and data                         | The original gist log, issue/PR metadata and comments, authenticated screenshot, relevant merged PR metadata, exact released sources, image manifest, reproduction outputs, and upstream report are under [`evidence/`](evidence/). [`MANIFEST.md`](MANIFEST.md) describes provenance.                                                                                                                           |
| Compile data under `docs/case-studies/issue-2244`          | This document, the manifest, checksums, and all immutable investigation artifacts live in this directory.                                                                                                                                                                                                                                                                                                        |
| Search online for facts and existing solutions             | Primary Docker, Node.js, Bash, Linux signal, and cgroup documentation is cited below. Related Hive Mind changes and exact dependency sources were inspected.                                                                                                                                                                                                                                                     |
| Reconstruct the timeline                                   | The evidence-backed UTC timeline is below. It distinguishes actual execution time from a status record reconciled four days later.                                                                                                                                                                                                                                                                               |
| List every requirement and find each problem's cause       | This table and the findings section cover the external SIGKILL, unbounded size probe, and diagnostic gap separately. Confidence and missing evidence are stated.                                                                                                                                                                                                                                                 |
| Propose solutions and plans, including existing components | The solution matrix compares the implemented standard-library timeout and existing Box logging switch with alternatives.                                                                                                                                                                                                                                                                                         |
| Add diagnostics when root cause data is insufficient       | Three layers were added: a self-narrating start gate, default-on DinD daemon logging (`HIVE_MIND_DIND_DAEMON_LOG=0` opts out), and a host-side container snapshot taken before reaping. Finding 4 explains why each was required.                                                                                                                                                                                |
| Report related external-project defects                    | The size hang went to Moby as [#53641](https://github.com/moby/moby/issues/53641); the two session-record defects went to start-command as [#170](https://github.com/link-foundation/start/issues/170) and [#171](https://github.com/link-foundation/start/issues/171). Each carries a runnable reproducer, measured output, workaround, and a code-level fix suggestion. Bodies and API responses are archived. |
| Apply the fix across the codebase                          | All production `SizeRw` sampling routes through `getDockerContainerWritableLayerSize`; both startup and session-monitor callers receive the deadline. The shared DinD argument builder covers all privileged DinD launches.                                                                                                                                                                                      |
| Plan and execute in one PR                                 | Code, tests, changeset, experiment, evidence, and this analysis are all in [PR #2245](https://github.com/link-assistant/hive-mind/pull/2245).                                                                                                                                                                                                                                                                    |

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

Box already provides the correct component: setting `DIND_LOG_FILE=/dev/stderr`.
The launch builder now applies it to every privileged DinD launch, not only
verbose ones — see finding 4 for why the verbose-only version was the wrong
call. `HIVE_MIND_DIND_DAEMON_LOG=0` restores the previous behavior for
deployments that do not want it. The exact-image verbose experiment captured
111 console lines including dockerd output. This does not reveal who sends a
future uncatchable SIGKILL, but it establishes whether daemon bootstrap was
healthy up to the kill.

### 4. Root cause of the missing logs: every layer wrote its evidence inside the container

Finding 3 named one stranded artifact. Measuring the whole pipeline showed the
same failure mode at three layers at once, which is why the incident produced a
37-line log for a six-second task. This was measured, not inferred: the harness
[`experiments/issue-2244-start-command-log-gaps.sh`](../../../experiments/issue-2244-start-command-log-gaps.sh)
reproduces the incident's shape (a gated, detached Docker session SIGKILLed 5.5
seconds in) with a small image, and captures what each layer preserved. The
before/after artifacts are under [`evidence/logging/`](evidence/logging/).

| Layer                     | What it should have recorded              | What it actually preserved                                                                                             |
| ------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Hive Mind start gate      | Whether the task command had even started | **Nothing.** The gate polled silently for up to 30 s, so a kill inside that window leaves no stdout _by construction_. |
| Box DinD entrypoint       | Daemon bootstrap progress and errors      | One banner line. dockerd went to `/var/log/dockerd.log` inside the container and died with it.                         |
| Hive Mind session monitor | The container's own state before cleanup  | **Nothing.** The retention policy removed the container; no `inspect`/`logs` snapshot was ever copied to the host.     |
| start-command record      | Exit code, signal, real finish time       | `Reason: exitCode=137 oomKilled=false` — and a store record still reading `status "executing"`, `exitCode null`.       |

The measured pre-fix run confirms each cell. `docker logs` for the entire
six-second container life was **empty** (0 bytes,
[`evidence/logging/before/docker-logs.txt`](evidence/logging/before/docker-logs.txt)),
and the session log never contains the words "signal" or "SIGKILL"
(`session_log_mentions_signal=0`). So the incident log is not evidence that the
task started and died instantly; it is equally consistent with the task never
starting at all — and nothing in the preserved artifacts can tell those two
apart. That ambiguity, not the kill itself, is why the investigation stalled.

The start-command record adds two more distortions, both reproduced three times
and reported upstream:

- The terminal state is **never persisted.** After a 137 exit the store still
  held `status "executing"`, `exitCode (null`, `endTime (null`
  ([`evidence/logging/before/stored-record.txt`](evidence/logging/before/stored-record.txt)).
- `$ --status` therefore recomputes the outcome on every query and fills
  `endTime` with `new Date()`. Two queries four seconds apart returned
  `22:19:51.688Z` and `22:19:55.735Z`, while Docker's `FinishedAt` was
  `22:19:47.944Z`. **This is the source of the issue's four-day-old `endTime`**:
  it was never a finish time, it was the time we happened to run the query, and
  the investigation initially read it as a task that had run for days.

Reported as
[link-foundation/start#170](https://github.com/link-foundation/start/issues/170)
(terminal state not persisted, `endTime` fabricated) and
[#171](https://github.com/link-foundation/start/issues/171) (the "kept for
investigation" log omits the signal and the container timestamps that were
available at that exact moment). Both include the runnable reproducer
[`experiments/start-command-detached-terminal-state.sh`](../../../experiments/start-command-detached-terminal-state.sh),
the measured output, a workaround, and file-and-line fix suggestions
(`src/lib/docker-cleanup.js` `buildDetachedDockerCompletionScript`, which
already reads `.State.ExitCode`/`.State.OOMKilled` and discards them; and
`src/lib/status-formatter.js:271,285,327`, where `endTime` is invented).

The Hive Mind side does not wait for those fixes. All three of its own gaps are
closed in this PR, and the after-state is verified end to end by
[`experiments/issue-2244-verify-full-logs.sh`](../../../experiments/issue-2244-verify-full-logs.sh).

## Solution design

| Problem                                       | Implemented solution                                                                                                                       | Existing component used                                                                    | Why this choice                                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Optional `SizeRw` walk can block forever      | Execute the Docker CLI directly with a 10,000 ms timeout and a 4 KiB output cap; return `null` on any failure.                             | Node.js `child_process.execFile` and `util.promisify`                                      | No shell interpolation or new dependency; Node supplies process timeout and buffer enforcement. The metric was already best-effort.                                                   |
| Start gate depends on the metric              | Keep the size call inside the existing `try/finally`, with its deadline below the 30-second child fallback.                                | Existing Hive Mind gate release                                                            | Preserves pre-workload baseline ordering without allowing an optional observation to own task liveness.                                                                               |
| DinD daemon log disappears with the container | Set `DIND_LOG_FILE=/dev/stderr` on every privileged DinD launch; `HIVE_MIND_DIND_DAEMON_LOG=0` opts out.                                   | Existing Box entrypoint switch                                                             | Captures diagnostics in the already-retained start-command log; no Box fork. Quiet runs are precisely the ones nobody is watching.                                                    |
| Start gate is silent, so its log is ambiguous | The gate announces its wait, a heartbeat every 5 s, its outcome, and the hand-off — all on stderr.                                         | The existing POSIX gate loop                                                               | Keeps the task's stdout byte-identical and the wait semantics unchanged, while making "not started yet" a positive statement.                                                         |
| Container state dies with the container       | Snapshot `docker inspect`, `docker logs`, and the nested `dockerd.log` into `<session>.log.diagnostics/` before the retention policy runs. | `src/docker-task-diagnostics.lib.mjs` (new), driven from the existing completion path      | The host is the only place that outlives the container. Every probe has a finite timeout and is non-fatal — repeating the original unbounded-probe mistake here would be inexcusable. |
| Exit 137 is reported without its meaning      | Decode `128 + N` to a signal name and quote `State.OOMKilled` in the completion notification.                                              | Existing `buildKillCompletionSections`                                                     | The one fact the incident log never stated. Ground truth now comes from the container, not from a guess about the exit code.                                                          |
| Original SIGKILL sender is unknown            | Preserve confidence boundaries and document the host artifacts needed on recurrence.                                                       | Existing start-command failed-container retention and Hive Mind killed-session diagnostics | Automatic retry cannot identify a kill source and may duplicate task side effects. Better evidence is required before adding policy.                                                  |

### Alternatives considered

- **Remove writable-layer measurements:** avoids the hang but regresses the
  task-scoped disk accounting added for issues #1999–#2001. A bounded
  best-effort measurement preserves the feature.
- **Increase the child gate timeout:** only moves the visible symptom and leaves
  the parent blocked. The optional operation itself needs a deadline.
- **Add a Docker SDK:** would add dependency and transport surface, while an API
  client deadline still cannot guarantee that the daemon cancels its internal
  size calculation. The Docker CLI is already a runtime prerequisite.
- **Stream dockerd only in verbose mode:** this was the original choice in this
  PR, and it was wrong. The incident run did request `--verbose`, but that
  argument reaches the _task_, not the launch, and the runs that go
  uninvestigated are exactly the quiet ones. Daemon output for a short-lived
  container is a few dozen lines against a log that routinely runs to thousands;
  the opt-out (`HIVE_MIND_DIND_DAEMON_LOG=0`) covers deployments that disagree.
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

### What was and was not reproduced

Stated plainly, because the distinction matters more than any single fix here:

| Claim                                                               | Reproduced?                                                                                                                                                                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The `docker inspect --size` hang on the incident image              | **Yes, deterministically**, on the exact image pinned by digest. This is a confirmed defect with a confirmed fix.                                                              |
| The exit-137 / near-empty-log _signature_                           | **Yes**, by injecting the kill (`docker kill --signal KILL` at 5.5 s). The reproduction shows the signature is produced by the logging pipeline, not by any particular killer. |
| The missing-logs root cause (all four layers in finding 4)          | **Yes**, measured directly, before and after the fix.                                                                                                                          |
| start-command's unpersisted terminal state and fabricated `endTime` | **Yes**, three separate runs, on 0.33.0 (latest published).                                                                                                                    |
| **The spontaneous SIGKILL of the original task**                    | **No.** It was never observed again, its sender was never identified, and the host artifacts that could name it were gone before the investigation began.                      |

So the honest answer to "did we reproduce it?" is: we reproduced everything
_around_ the kill and nothing _of_ the kill. The value of this PR is therefore
not that it fixes the SIGKILL — it does not — but that the next occurrence
cannot be this opaque: the gate says whether the task started, the daemon log is
on the host, and the container's own state is snapshotted before it is reaped.

### Verifying the after-state

[`experiments/issue-2244-verify-full-logs.sh`](../../../experiments/issue-2244-verify-full-logs.sh)
runs the shipping `buildDockerStartGatedCommand` and
`captureDockerTaskContainerDiagnostics` against a real container killed at
5.5 s, and asserts seven properties. All pass
([`evidence/logging/after/summary.txt`](evidence/logging/after/summary.txt)):
the container's own output now carries
`[hive-mind] start-gate: waiting up to 30s at …` and
`still waiting after 5s` — positive proof the task had not started — and the
host snapshot survives `docker rm -f` with `signal=SIGKILL`, real
`startedAt`/`finishedAt`, and `lifetime=6.2s`.

Two honest limitations are recorded there rather than papered over: with a plain
`alpine` image there is no nested daemon, so `dockerd.log` is legitimately absent
and the capture reports it as an error; and when the container is killed _inside_
the gate, no outcome line is printed, because the process never reaches it. The
waiting and heartbeat lines are what carry the information in that case.

### The exact-image harness

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
- malformed size output remains best-effort;
- daemon logs are on by default for DinD launches, never for non-DinD images,
  and can be switched off per deployment;
- the gate emits its waiting/heartbeat/outcome/hand-off markers, on stderr only,
  with unchanged wait semantics — asserted both on the generated string and by
  executing it under a real `sh` on both the released and timed-out paths;
- the container snapshot decodes signals, honors its policy, resolves its
  destination, writes every artifact, bounds every probe with a finite timeout,
  and degrades without throwing when `inspect`/`cp` fail or the destination is
  unwritable (`tests/test-issue-2244-container-diagnostics.mjs`); and
- the monitor captures **before** it removes the container and before it
  notifies, and the notification names the signal, or out-of-memory when
  `State.OOMKilled` is true (`tests/test-issue-2244-monitor-diagnostics.mjs`).

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
service journal.

The first three of those commands are now run automatically: the monitor writes
`container-inspect.json`, `container-logs.txt`, `dockerd.log`, and a decoded
`summary.txt` into `<session-log>.diagnostics/` before the container is removed,
and the completion notification points at the directory. The remaining
host-scoped records (`docker events`, the daemon journal, the kernel log, and
cgroup counters) still have to be collected by hand, because only they can
identify an external `SIGKILL` sender. Set
`HIVE_MIND_DOCKER_DIAGNOSTICS=always` to capture the snapshot on successful runs
too when chasing an intermittent startup failure.

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
- [moby/moby#53641](https://github.com/moby/moby/issues/53641) — the
  `docker inspect --size` hang reported from this investigation.
- [link-foundation/start#170](https://github.com/link-foundation/start/issues/170)
  — detached Docker terminal state is never persisted and `endTime` is
  fabricated at query time.
- [link-foundation/start#171](https://github.com/link-foundation/start/issues/171)
  — the "kept for investigation" log omits the post-mortem facts available at
  that moment.

## Conclusion

The original task did not merely “fail to start”: it was externally killed
during DinD bootstrap, and the surviving evidence cannot name the sender. That
kill was never reproduced and its sender is still unknown.

What _was_ reproduced is arguably the more consequential defect. The reason the
incident was undiagnosable is not that logging failed under stress; it is that
every layer wrote its evidence into the container that was about to die, and the
one durable record — start-command's session log — described the ending without
ever naming it. A silent 30-second gate, a daemon log on a doomed filesystem, a
container reaped before anyone looked at it, and an `endTime` invented at query
time together turned a six-second failure into an unanswerable question.

Bounding the optional size metric restores launch liveness. The narrated gate,
the default-on daemon log, and the host-side container snapshot mean the next
early failure arrives already explained — or, where it cannot be explained, with
the boundary of what is known stated honestly rather than filled in with a
plausible story. The implementation still refuses to invent an OOM story from
exit 137, and still refuses to retry blindly.
