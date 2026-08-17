# Improvements, existing components, and remaining risk — issue 2160

## Solution plan per requirement

| Requirement                                                            | Plan                                                                                                                                                                | State                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| R1 root-cause and fix every false positive/negative, warning and error | P1–P8, each with a reproducing test first                                                                                                                           | Done — see [TECHNICAL_ANALYSIS.md](./TECHNICAL_ANALYSIS.md) |
| R2 collect the evidence into this folder                               | Sanitized gzip log + 65 GitHub JSON snapshots + integrity index                                                                                                     | Done — see [MANIFEST.md](./MANIFEST.md)                     |
| R3 deep case study with online research and a component survey         | Timeline and requirement table in [README.md](./README.md); this survey below                                                                                       | Done                                                        |
| R4 add diagnostics where data was missing                              | Per-task disk accounting, reclaim reasons, deferral counters, real cleanup reason                                                                                   | Done                                                        |
| R5 report upstream defects                                             | One external finding, filed as [anthropics/claude-code#87303](https://github.com/anthropics/claude-code/issues/87303) with reproduction, workaround and fix options | Done — submitted text in [`upstream/`](./upstream/)         |
| R6 apply each fix everywhere                                           | Per-defect call-site audit (both `cleanupTempDirectories` sites; all `batchCheckPullRequestsForIssues` consumers; all six restart-path executors)                   | Done                                                        |
| R7 one pull request                                                    | [PR #2162](https://github.com/link-assistant/hive-mind/pull/2162)                                                                                                   | Done                                                        |

## Existing components and libraries considered

### Free-space measurement

| Option                                                                                                                                                                      | Assessment                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`check-disk-space`](https://www.npmjs.com/package/check-disk-space) (~1.1M weekly downloads, no native deps; shells out to `df` on POSIX and `wmic`/PowerShell on Windows) | Closest match to what the guard needs. Rejected for now because Hive Mind resolves dependencies at runtime through use-m and the guard must work when nothing can be fetched; the single `df -Pk` call is ~10 lines and is the same mechanism the library uses internally on Linux, which is the only platform the DinD image targets. |
| [`diskusage`](https://www.npmjs.com/package/diskusage) (native `statvfs`/`GetDiskFreeSpaceEx`)                                                                              | Most accurate and avoids parsing text, but a native addon in a runtime-resolved dependency chain is a build risk inside the container for a value used once per task.                                                                                                                                                                  |
| [`node-disk-info`](https://www.npmjs.com/package/node-disk-info)                                                                                                            | Enumerates all filesystems; more than needed, and the parsing surface is larger than `df -Pk`.                                                                                                                                                                                                                                         |
| `fs.statfs` (Node ≥ 18.15)                                                                                                                                                  | Attractive: no dependency, no parsing. Worth migrating to — tracked as follow-up F1 below. The run's Node v24.3.0 supports it.                                                                                                                                                                                                         |

`df -Pk` was chosen deliberately: `-P` guarantees POSIX single-line-per-filesystem output, which is
what makes the parse safe against long device names that otherwise wrap.

### Temp-directory reclamation

- **systemd-tmpfiles** ageing (`10d` for `/tmp`, `30d` for `/var/tmp`, per systemd.io's _Using /tmp/
  and /var/tmp/ Safely_) is the standard answer for host-level cleanup, but its time-based policy is
  far too slow for a run that fills 65 GB in four hours, and it is not available inside every
  container.
- The known incidents where tmpfiles ageing deleted _in-use_ files
  ([NixOS/nixpkgs#86600](https://github.com/NixOS/nixpkgs/issues/86600), Ubuntu
  [LP#2088268](https://bugs.launchpad.net/ubuntu/+source/systemd/+bug/2088268)) are the reason the
  guard is built on "enumerate, then never touch anything busy" rather than on age alone: a
  long-running solve session can leave a workspace untouched for hours and still need it.
- **tmpreaper** has the same age-based model and the same blind spot, plus it is Debian-specific.
- `/proc/<pid>/cwd` scanning is what `lsof`/`fuser` do for the cwd case, without requiring either
  binary in the image. `fuser -m` would additionally catch open file handles outside the cwd; the
  cwd signal is sufficient here because the AI tool runs _in_ its workspace, and adding open-handle
  detection is follow-up F2.

### Exit-code semantics

`EX_TEMPFAIL = 75` comes from `sysexits.h` and is documented as "temporary failure, indicating
something that is not really an error … the request should be reattempted later"
([sysexits(3)](https://man.netbsd.org/sysexits.3),
[man7.org sysexits.h](https://man7.org/linux/man-pages/man3/sysexits.h.3head.html)). Reusing it
rather than inventing a code means existing supervisors and CI retry policies interpret hive's
"blocked, not broken" outcome correctly with no extra configuration.

### Queue-level backpressure

The deferral mechanism added here is a hand-rolled admission control. Established alternatives
(`p-queue` concurrency/interval limits, `bottleneck` reservoirs) throttle by _rate_, not by an
external resource that in-flight work releases, so neither expresses "hold this task until a peer
frees 10 GB". The requeue-with-deferral-counter approach also preserves the existing `IssueQueue`
semantics (`queue`/`processing`/`completed`/`failed` + `deferrals`), which is why it was preferred
over replacing the queue.

## Remaining risk and follow-ups

| ID  | Item                                                                                                                     | Rationale                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | Replace the `df -Pk` child process with `fs.statfs`                                                                      | Removes text parsing and a process spawn per task; keep `df` as fallback for older runtimes                                                                                                |
| F2  | Extend busy detection to open file handles (`/proc/<pid>/fd`), not just cwd                                              | A worker holding a log file open in a workspace it is not sitting in is currently only protected by `protectedPaths`                                                                       |
| F3  | Decide whether `--auto-cleanup` should default _on_ for orchestrated runs                                                | The public-repository default is what filled the disk. The safe cleanup from P7 makes on-by-default defensible, but changing a default is a behaviour change and belongs in its own change |
| F4  | Report disk-blocked tasks in the final summary as a distinct line (`⏸️ N deferred`) rather than only in the exit message | Makes the outcome legible without reading the exit code                                                                                                                                    |
| F5  | Emit the marginal disk cost per completed task                                                                           | 10.8 GB/task was derived by arithmetic here; measuring it directly would let hive predict how many tasks a host can run                                                                    |

Note on scope: F1–F5 are deliberately **not** in PR #2162. Each is an enhancement beyond "find and
fix the causes of the reported symptoms", and F3 in particular changes observable defaults.

## Sources consulted

- [sysexits(3), NetBSD](https://man.netbsd.org/sysexits.3) and
  [sysexits.h(3head), man7.org](https://man7.org/linux/man-pages/man3/sysexits.h.3head.html) —
  `EX_TEMPFAIL` retry semantics.
- [systemd.io — Using /tmp/ and /var/tmp/ Safely](https://systemd.io/TEMPORARY_DIRECTORIES/) and
  `systemd-tmpfiles(8)` — default ageing policy and its dry-run mode.
- [NixOS/nixpkgs#86600](https://github.com/NixOS/nixpkgs/issues/86600),
  [Ubuntu LP#2088268](https://bugs.launchpad.net/ubuntu/+source/systemd/+bug/2088268) — reports of
  age-based tmp cleanup deleting files still in use.
- [`check-disk-space`](https://www.npmjs.com/package/check-disk-space),
  [`diskusage`](https://www.npmjs.com/package/diskusage),
  [`node-disk-info`](https://www.npmjs.com/package/node-disk-info) — free-space libraries compared
  above.
- [anthropics/claude-code#6805](https://github.com/anthropics/claude-code/issues/6805) — the
  token-accounting duplication P8 refers to; verified closed 2026-02-14 as inactive and locked
  2026-02-21, still reproducing on CLI 2.1.228/2.1.233, hence the fresh report
  [#87303](https://github.com/anthropics/claude-code/issues/87303).
