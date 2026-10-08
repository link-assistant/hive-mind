# Issue #2745: Codex failure without an actionable cause

[Issue #2745](https://github.com/link-assistant/hive-mind/issues/2745) reports a bare `CODEX execution failed` message for [Router PR #742](https://github.com/link-assistant/router/pull/742). The underlying run exited 137 after repeatedly exhausting a roughly 2.92 GiB container while compiling Rust. Hive Mind logged the exit code internally but discarded it in the returned result, leaving the common failure formatter without a cause and the existing SIGKILL recovery gate without termination metadata.

[PR #2746](https://github.com/link-assistant/hive-mind/pull/2746) fixes the adapter, adds a container memory budget to the Codex prompt, and preserves the incident and regression evidence. A budget-aware prompt reduces the chance of repeating the resource problem; it cannot guarantee that a compiler or an agent will stay below the limit.

## Requirements and disposition

| Issue requirement                                                                  | Evidence or implementation                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Include at least one message identifying the failure cause                         | Nonzero exits return and log a process error with code/signal and a bounded plain stderr diagnostic when available; the existing formatter forwards it to terminal, PR draft reason and failure comments.                                                              |
| Investigate and address the underlying failure                                     | Timeline below establishes cgroup exhaustion and overlapping/large Rust builds. The prompt provides the real task budget and sequential/focused-build guidance; exit metadata restores existing recovery eligibility. Router's compile footprint is reported upstream. |
| Download all available logs and related data                                       | Complete original Gist, previous attempt, issue/PR discussions, reviews, related PRs and upstream reports are preserved in `data/`. Empty comment/review responses are retained.                                                                                       |
| Deep case study, timeline, all root causes, online research and possible solutions | This document, the Router report, primary-source references and reproducible analysis script.                                                                                                                                                                          |
| Use existing components/libraries                                                  | Reuse `readCgroupMemory`, line buffering, authoritative Codex error summaries, common failure formatting, bounded log reads and existing kill recovery. No new dependency.                                                                                             |
| Add missing diagnostic detail with verbosity off by default                        | Per-attempt before/after cgroup snapshots are verbose-only. The actionable terminal cause is always logged.                                                                                                                                                            |
| Reproduce before fixing; add regression coverage                                   | Offline adapter replay initially failed all 11 checks because status/cause were absent. Final coverage includes an additional echoed-limit guard. Logs are preserved with validation.                                                                                  |
| Report applicable upstream issues with reproducer/workarounds/proposed fixes       | Router report includes isolated finite compilation, observed mitigations and a proposed profile/test-unit split. Existing command-stream and Formal AI reports are reviewed below.                                                                                     |
| One PR, release preparation and complete checks                                    | Patch Changeset, default-branch merge, full local/CI checks, updated PR description and review status. Validation details are recorded separately.                                                                                                                     |

## Evidence provenance

The authenticated `gh gist view` download preserves the complete incident: 24,708 lines. `data/incident.log.gz` is a lossless gzip archive; the SHA-256 of its decompressed contents is recorded in `data/incident-analysis.json`. Source line numbers below refer to the decompressed original, not the shorter generated evidence file. The log ends during upload preparation; no later footer or kernel victim trace is available in the supplied Gist.

`experiments/issue-2745/analyze-incident.py` reads the archive in chunks of at most 1,500 lines, counts only stdout protocol events and records selected lifecycle, build and resource events with original line numbers. `data/memory-command-evidence.json` retains the complete two relevant memory-command outputs, including the process list. Stderr telemetry echoes are deliberately excluded from protocol counts.

The prior attempt to solve this issue has a separate archived log, `data/previous-attempt.log.gz`, copied from the repository's development-session archive. It failed on Formal AI interpreting `e.g.` as a missing file, before implementing a fix. That failure is not the Codex incident reported in #2745. Its PR comment also records an integration token being unable to upload a Gist. [PR #2614](https://github.com/link-assistant/hive-mind/pull/2614) already supplies log-preservation fallback and documents [Formal AI #1189](https://github.com/link-assistant/formal-ai/issues/1189); both discussions are archived here rather than duplicating those reports.

No image attachment appears in the issue or its comments; this is a process/diagnostic defect, so screenshots are not applicable.

## Incident timeline (UTC, 2026-10-07)

| Time              | Original line(s)      | Observation                                                                                                                                                              |
| ----------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 21:28:09          | 17                    | Solve starts: host RAM 12,541,493,248 bytes, cgroup limit 3,135,373,312 bytes, current 635,551,744; OOM events/kills both zero.                                          |
| 21:28:15–23       | 112–334               | Validation probe starts and completes normally. Its completed turn is separate from the working session.                                                                 |
| 21:28:36          | 460                   | After clone: cgroup usage 894,947,328 bytes, peak 1,226,612,736; no OOM kills yet.                                                                                       |
| 21:29:08–09       | 664, 760–840          | Codex `gpt-6.1-sol`, xhigh reasoning, starts working session `01a11845-2bf1-7c22-bf7b-c51d8409b7c0`.                                                                     |
| 21:36:25–43       | 4909–5095             | Provider 503/capacity errors end the first turn with an authoritative `turn.failed`.                                                                                     |
| 21:36:44–21:39:47 | 5168–5408             | Existing transient retry waits three minutes and resumes the same session. Capacity is recovered; it is not the final failure.                                           |
| 21:39:59–21:42:17 | 5639, 6119, 6478–6704 | Library and integration Cargo invocations overlap, each with two jobs. Library exits 101; captured rustc output says SIGKILL. `memory.events` already records two kills. |
| 21:42:17 onward   | 6716–6783             | One-job builds with package debug disabled are attempted, including overlapping separate invocations. One job per invocation does not cap total concurrent memory.       |
| 21:59:13–22:06:20 | 13438–16067           | Full test compilation with reduced settings still fails; captured compiler output again reports SIGKILL.                                                                 |
| 22:22:59          | 23074                 | A later clippy retry completes successfully.                                                                                                                             |
| 22:23:32–22:25:45 | 23222–23766           | Focused denial integration target passes with one job, reduced debug settings, CPU affinity and 1,024 codegen units.                                                     |
| 22:26:06          | 23931                 | Full all-features suite starts again with those mitigations.                                                                                                             |
| 22:28:42          | 24542                 | Cgroup current 3,130,822,656 bytes: only 4,550,656 bytes below the hard limit. Rustc RSS is 2,219,048 KiB, plus two Codex processes, Cargo and Hive Mind.                |
| 22:29:23          | 24663                 | Codex command exits 137 without a final `turn.failed`/`turn.completed` for the resumed run.                                                                              |
| 22:29:23          | 24683                 | After agent: peak 3,135,520,768, current drops to 549,351,424, cumulative OOM events 216 and OOM kills 23. Host memory still shows 9.4 GB available.                     |
| 22:29:24          | 24687                 | PR is converted to draft using only `CODEX execution failed`.                                                                                                            |
| 22:29:25          | 24704                 | Log upload starts; the supplied archive ends during this phase.                                                                                                          |

These measurements establish repeated cgroup OOM activity and a nearly saturated task container. They strongly support memory pressure contributing to the final SIGKILL. They do not identify the exact victim of each kill, nor prove that the final Codex PID was selected by the kernel; signal 9 can also be sent by another process. The original log lacks per-attempt cgroup samples, so its 23 kills span the whole solve, not just the final CLI invocation.

## Root causes and code path

1. **Resource exhaustion:** Rust compilation and concurrent Cargo invocations share the container's hard memory budget with Codex and Hive Mind. The host-level `getResourceSnapshot()` reports host RAM and can show abundant free memory even when the cgroup is full. Single-job/focused builds helped individual targets but did not make the full build fit.
2. **Empty process failure result:** `executeCodexCommand` handled a nonzero exit by returning `getCodexErrorEventSummary(state)`. A SIGKILL cannot emit a structured error, so that summary had `hasError: false`, `message: null`, and no `result`. `formatToolExecutionFailure` consequently used the generic phrase even though the adapter had logged 137.
3. **Lost recovery signal:** `buildRunResult` omitted exit code and signal. `isToolProcessKilled` checks those fields; callers with existing bounded kill recovery therefore could not recognize a Codex kill. Initial solve handling does not gain a new retry loop in this PR; existing watch/auto-merge recovery policies remain in control.
4. **Insufficient resource context:** Whole-solve resource counters and host free memory did not tie OOM evidence to a specific CLI attempt. The fix samples the existing cgroup reader before and immediately after every attempt. Only increasing kill counters from the same cgroup path/version support fresh OOM evidence. Missing, unchanged, reset or different-cgroup counters report an unknown cause.
5. **Other nonzero exits also lose detail:** Plain CLI/shell stderr errors were not promoted to a failure cause. The fix keeps a bounded diagnostic from complete lines, including a chunk-split final line. JSON/OTEL echoes remain nonprotocol; authoritative `turn.failed` and existing provider-limit behavior keep priority.

The shared formatter is used for terminal output, draft conversion and failure publication, so supplying the cause at the adapter fixes those reporting paths together. Agent work summaries and arbitrary command output are not used as process error text. A signal exit also bypasses provider-limit classification of the last stdout chunk, which can contain a quoted historical limit from a tool.

## Primary-source research and related work

- [Codex non-interactive execution](https://developers.openai.com/codex/noninteractive) documents stdout JSONL events (`turn.started`, `turn.completed`, `turn.failed`, `error`) and stderr diagnostics. Hive Mind already separates these streams; a killed process can end without a terminal protocol record. The fix supplements protocol errors with process status rather than inventing a missing JSON event.
- [Linux cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html) documents `memory.max`, `memory.current`, `memory.peak` and cumulative `memory.events` counters. `memory.max` constrains a task even when host memory is available. An OOM kill counter records victims in the cgroup and is not a PID-level attribution mechanism.
- [Cargo build](https://doc.rust-lang.org/cargo/commands/cargo-build.html) and [configuration](https://doc.rust-lang.org/cargo/reference/config.html) describe build-job limits and `CARGO_BUILD_JOBS`. The limit applies to one Cargo invocation; separate invocations and the agent still share the same memory controller.
- [Cargo profiles](https://doc.rust-lang.org/cargo/reference/profiles.html) document debug, incremental and codegen settings. These are useful proposed mitigations, not a guarantee that a large test compilation fits a particular budget.
- [PR #2690](https://github.com/link-assistant/hive-mind/pull/2690) establishes the nearby precedence rule: terminal provider errors must survive earlier failed tool commands. This fix retains Codex's authoritative structured error path and completed-turn behavior.
- [command-stream #208](https://github.com/link-foundation/command-stream/issues/208) reports signal status loss for its direct shell file/args API. The finite `experiments/issue-2745/command-stream-signals.mjs` probe uses Hive Mind's actual `sh -c` invocation shape: TERM/KILL report 143/137 correctly. That upstream defect is not reproduced on the adapter's normal shape and does not require a duplicate issue. Signal-only event normalization is supported defensively if a future transport emits one.

## Solutions considered and limits

**Implemented:** preserve exit/signal on run results; always supply a meaningful process error for nonzero exits; attach comparable before/after cgroup evidence; expose verbose samples; include finite task memory budget and guidance in the prompt; reuse existing recovery and error formatting. A small helper extraction preserves the 1,350-line regression boundary and the existing 1 MiB final-message read cap.

**Upstream follow-up:** [Router #745](https://github.com/link-assistant/router/issues/745) requests documented low-memory builds, compiler peak measurements, isolated full CI validation and smaller compilation/test units if needed. The separate report includes a bounded container recipe, workarounds demonstrated by the incident, and a proposed Cargo profile.

**Not selected:** treating every 137 as proven OOM, changing global Docker memory defaults, increasing the task limit automatically, forcing one Cargo setting into every repository, suppressing incomplete-turn checks, or adding unbounded retries. Each would either misattribute unrelated kills or change operator policy without evidence that it fixes the compiler footprint.

The task cap already has an operator override through `--container-memory` / `TELEGRAM_CONTAINER_MEMORY`; a larger budget requires sufficient host capacity. Prompt guidance and restored recovery eligibility cannot make an intrinsically oversized compiler fit, and an OOM that kills Hive Mind itself before it returns still relies on the outer process/container diagnostics.

## Reproduction and validation

Run the hermetic regression with:

```bash
node --test tests/codex-process-exit-2745.test.mjs
```

The fake process emits the incident's `thread.started`, `turn.started` and exit 137 without a terminal JSON error. Injected snapshots use the incident's memory limit and counter shape. The test checks the returned error, default-visible log, public formatter and existing kill-recovery gate, without allocating excessive memory or invoking a model.

Coverage also includes signal-only termination; stale/reset/unreadable/different-cgroup OOM counters; missing cgroup data; split and unterminated stderr; telemetry echoes; structured-error priority; successful completed turns; and echoed usage-limit text on SIGKILL. Full validation and CI evidence are recorded in `validation.md`.
