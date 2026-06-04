# Case Study - Issue #1851: Debug agent processes

> **Issue:** [Add command to debug claude/codex and other processes](https://github.com/link-assistant/hive-mind/issues/1851)
> **Branch:** `issue-1851-e32e0e6d591c` - **PR:** [#1852](https://github.com/link-assistant/hive-mind/pull/1852)

This case study records the process-debugging failure mode from issue #1851.
The raw issue body included command lines and credentials from a production-like
server. Those values are intentionally not stored here; the data file in this
folder contains only redacted, structural observations.

## Problem

Long-running servers can accumulate AI-agent processes that are no longer
attached to a useful hive/start-command task. The operator symptom is usually a
high-CPU `claude` or `codex` process where `top -c` shows a PID, but the
maintainer still has to answer:

- which hive task launched this PID,
- which start-command session and log file own it,
- which temporary workspace it is using,
- whether the task is still live or has already reached a terminal state,
- whether it is safe to stop the process tree without killing active work.

The manual fallback used `/proc/<pid>`, `screen -ls`, `STY` environment values,
working directories, and start-command logs. That worked, but it was slow and
easy to get wrong when an agent had been reparented to PID 1.

## Requirements

| #   | Requirement                                                                      | Implementation                                                                                                                |
| --- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| R1  | Add a command to map `claude`, `codex`, and related agent PIDs to hive tasks.    | `cleanup --processes`                                                                                                         |
| R2  | Support arbitrary high-CPU PIDs, not only recognized agent names.                | `cleanup --pid <pid[,pid...]>`                                                                                                |
| R3  | Link processes to start-command session IDs, logs, task URLs, and workspaces.    | `src/process-debug.lib.mjs` correlation plus `/proc`, screen, and log collection in `src/cleanup.os.lib.mjs`                  |
| R4  | Detect orphaned agents for terminal sessions, including PID-1-reparented agents. | `correlateProcesses()` marks matched terminal-session agents as orphaned when no live session remains and the parent is PID 1 |
| R5  | Make termination explicit and reviewable.                                        | `cleanup --kill-orphaned-agents` is a dry-run unless `--force` is also passed                                                 |
| R6  | Avoid leaking credentials in diagnostics.                                        | `redactProcessText()` masks common token shapes before reports print command lines                                            |
| R7  | Add a reproducible test for the observed bug.                                    | `tests/test-issue-1851-process-debug.mjs`                                                                                     |

## Chosen approach

The implementation keeps matching logic pure and testable:

- `process-debug.lib.mjs` parses log metadata, redacts command text, correlates
  supplied process/session records, and formats reports.
- `cleanup.os.lib.mjs` performs Linux-specific collection from `/proc`, GNU
  screen, start-command logs, and optional `$ --status` lookups.
- `cleanup.mjs` exposes the operator commands and requires `--force` before
  any orphaned process is signalled.

This keeps normal disk cleanup behavior unchanged while giving operators a
single command for the manual investigation previously documented in README.

## Operator workflow

```bash
# Show linked agent processes and possible orphans.
cleanup --processes

# Trace one arbitrary PID from top/ps.
cleanup --pid 94445

# Preview terminal-session orphan cleanup.
cleanup --kill-orphaned-agents --dry-run

# Stop the orphaned agent process trees after reviewing the preview.
cleanup --kill-orphaned-agents --force
```

See [`data/redacted-observations.md`](./data/redacted-observations.md) for the
sanitized observations used to shape the test.
