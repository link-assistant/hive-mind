# Issue 194: historical child OOMs mislabeled a Docker restart

[Issue](https://github.com/link-foundation/start/issues/194) · [PR 196](https://github.com/link-foundation/start/pull/196) · [downstream incident](https://github.com/link-assistant/hive-mind/issues/2892)

[Downstream fix report](https://github.com/link-assistant/hive-mind/issues/2892#issuecomment-6089357423) includes the reproduced classification, bounded test commands, workarounds and code-fix recommendations. A local copy is preserved in `data/upstream-fix-report.json`.

## Preserved evidence and reconstructed timeline

The original issue/comments, downstream report/comments, and [Moby #43564](https://github.com/moby/moby/issues/43564) snapshot are in `data/`. [The evidence manifest](data/evidence-manifest.json) points to the complete shared incident archives and numbered excerpts in [issue 195's data](../issue-195/data/). Source hashes and credential redactions are documented there.

| UTC on 2026-10-09 | CEST in host journal | Event                                                                                                                                                               |
| ----------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Earlier that day  | Earlier that day     | Four tasks survive child `rustc`/`clippy-driver` OOM kills: router #724 ×5, #725 ×3, #727 ×2, #728 ×2. Their limits are 2.9 GiB and Docker's OOM flag remains true. |
| 12:11:39          | 14:11:39             | Kernel globally OOM-kills host dockerd PID 823, `anon-rss:7302520kB`. Downstream investigation associates this with roughly 22 concurrent Docker diff calls.        |
| 12:11:41          | 14:11:41             | `docker.service: Main process exited, code=killed, status=9/KILL`.                                                                                                  |
| 12:11:45          | 14:11:45             | New dockerd begins loading containers.                                                                                                                              |
| 12:11:55          | 14:11:55             | Matching-container journal entries say the tasks failed to exit within ten seconds of signal 15 and were force-killed. Tasks and root bot exit 137.                 |
| 13:31             | 15:31                | Root bot restarted manually; it classifies sticky `OOMKilled=true` plus 137 as task OOM. Root container has `OOMKilled=false` despite the same restart kill.        |
| 15:03:39          | 17:03:39             | Downstream comment links the upstream reporting issue.                                                                                                              |

This is a host dockerd OOM followed by task kills during Docker restoration. The task exit reason must not claim that their earlier child OOM events killed their main process. The host journal supplies stronger attribution than coincident finish times.

## Root causes and authoritative facts

`exit-reason` used sticky `State.OOMKilled` or nonzero cumulative `oom_kill` plus exit 137 as sufficient proof. Status could also retain this wrong verdict from an older record. Recovery and attached reporting had related assumptions.

The kernel's `memory.events` counters count cumulative events for a cgroup and descendants. They do not identify the main process or the reason for its later exit. [Linux cgroup documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files). The observed Docker flag behavior is already reported in [Moby #43564](https://github.com/moby/moby/issues/43564); no duplicate upstream Docker bug is opened for that known behavior.

Docker normally shuts down containers when the daemon terminates. Live restore can retain Linux containers across daemon outages, subject to daemon configuration and upgrade restrictions. [Docker live restore documentation](https://docs.docker.com/engine/daemon/live-restore/). This is an operational workaround; the PR does not change daemon configuration.

## Every requirement and solution choice

| Requirement                                                  | Alternatives                                                                | Implemented solution and test                                                                                                                                                                                                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Require exit-time main-process OOM evidence                  | Kernel journal matching init PID/container; recent sampled `oom_kill` delta | Use a sampled delta near `FinishedAt` together with OOM flag and main-process SIGKILL/unknown exit. First observed nonzero counters are historical. Validate ordered timestamps and a 3-second exit-time bound; malformed/stale data never qualifies.                |
| Detect real daemon restarts                                  | Service start time; simultaneous exits; attributed service journal          | Query local `docker.service` around finish, require a service stop/exit/start marker plus a force-kill line containing the exact 64-character container ID. Restart evidence takes precedence over a recent delta. Coincident exits alone never establish causation. |
| Diagnose sticky=true and sticky=false tasks consistently     | Preserve old OOM verdict; recompute evidence                                | Both journal-attributed cases report `killed (docker daemon restart)` and no memory-exhaustion verdict. Tests cover both flags.                                                                                                                                      |
| Explicit unknown cause when evidence is inaccessible         | Guess from flags; conservative result                                       | Report `signal (SIGKILL; cause unknown)`. Remote daemon journals are not read from the caller's host. Missing journal access is an evidence limit, not an OOM diagnosis.                                                                                             |
| Apply across all callers and old records                     | Patch list only; common classification policy                               | Watchers, finalizer, status/list, attached results and automatic memory recovery share evidence markers. Persist terminal evidence when the log is unavailable; clear stored stale cgroup/Docker reasons; retain raw `oomKilled`, exit code and counters.            |
| Keep #178 behavior                                           | Treat any child OOM as recovery trigger; main-exit guard                    | Exit 0/1 remains final. A non-OOM 137 can retain existing bounded kill recovery, but cannot trigger `--on-kill-resume-memory`.                                                                                                                                       |
| Preserve all incident data and research                      | Excerpts only; complete archive                                             | Complete compressed logs with hashes, local issue/downstream copies, [research and components](../issue-195/research.md), timeline and safe fixtures.                                                                                                                |
| More tracing when evidence is incomplete                     | Always dump journal; opt-in output                                          | Logs carry an `Exit evidence:` marker with the selected source or explicit unavailable reason. `START_DEBUG=1` enables launch/lock/worker diagnostics; defaults stay quiet.                                                                                          |
| Report downstream with reproduction, workaround and code fix | Duplicate existing issue; update incident                                   | Report the conservative classification and regression commands in existing Hive Mind #2892, linked to PR 196.                                                                                                                                                        |

## Safe reproduction

`bun test ./js/test/regression-194.js` and `cd rust && cargo test --test regression_194` exercise a historical child OOM followed by 137, recent/stale/malformed deltas, matching versus unrelated journals, restart precedence, both sticky flag values, and persistence without a log file. Neither suite kills dockerd or exhausts host memory.

Before: `{exitCode:137, oomKilled:true, cgroupMemory:{oomKills:3}}` reports memory exhaustion. After: the same historical facts report unknown SIGKILL; adding an attributed Docker service/force-kill journal reports a daemon restart. Only fresh OOM evidence establishes a terminal cgroup OOM.

A recent cgroup delta is temporal attribution rather than a main-PID identity proof: an unrelated child could be killed at almost the same instant. This implements the issue's permitted delta alternative; daemon journal evidence wins when available. One-second sampling can miss the final event, particularly when the cgroup vanishes, and inaccessible remote/system journals limit positive classification. These limits deliberately yield unknown instead of reconstructing missing evidence.
