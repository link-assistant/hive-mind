# Issue 1670 Case Study: Solve Completion Status Monitoring

## Source Artifacts

- Original issue metadata: `issue-details.json`
- Original issue comments: `issue-comments.json`
- Latest issue and PR snapshots: `raw-data/issue-1670.json`, `raw-data/issue-1670-comments.json`, `raw-data/pr-1675.json`
- Linked failed solution draft evidence: `raw-data/pr-1672-comment-4316480820.json`, `raw-data/pr-1672-solution-draft-log-pr-1777065660519.txt`
- Previous solution PR metadata: `pr-1671-details.json`
- Current solution PR metadata: `raw-data/pr-1675.json`
- Reported screenshots:
  - `stale-session-error.png`
  - `retry-started-message.png`
  - `assets/issue-body-first.png`
  - `assets/issue-body-second.png`
  - `assets/issue-comment-4316462291.png`

## External Research

- GNU Screen documents detached/background sessions and `screen -ls` listing behavior: https://www.gnu.org/software/screen/manual/screen.html
- Node.js `child_process` documentation describes process execution APIs used by the existing helper layer: https://nodejs.org/api/child_process.html

The relevant finding is that `screen -ls` describes screen socket state, not the higher-level `solve` task result. For `--isolation screen`, start-command's `$ --status <session>` is the task-status authority when it returns a concrete status such as `executing` or `executed`. Node's process APIs remain useful for launching and observing local helpers, but they cannot reconstruct a detached task's final result unless that result is persisted by the runner.

## Timeline

1. A user ran `/codex https://github.com/xlabtg/Teleton-Client/pull/2 --think max`.
2. The bot rejected the retry with "A working session is already running for this URL" and referenced session `77cf7b88-2fbf-48ef-85f2-7c2b2ce00763`.
3. Manual `$ --status 77cf7b88-2fbf-48ef-85f2-7c2b2ce00763` showed the underlying command had `status executed` and `exitCode 1`.
4. The Telegram message still showed "Solve command started successfully!" instead of a terminal failed/completed status.
5. A later retry started again under the same screen-isolation session name, demonstrating that `$ --status` can be used to distinguish executing work from completed work.
6. PR #1671 added the first layer of `$ --status` monitoring and queue counting.
7. The follow-up issue comment on 2026-04-24 showed session `e07625cb-63e5-4081-884c-4d21079b5968` stuck in an executing Telegram message even though `$ --status` reported `status executed` and `exitCode 0`.
8. The same comment linked failed PR #1672, where the session `39ae5500-d512-488f-bfe5-8532c358fd73` later reported `status executed`, `exitCode 1`, `startTime "2026-04-24T21:17:56.192Z"`, and `endTime "2026-04-24T21:39:03.630Z"`.

## Requirements Extracted

- Use `$ --status` for `--isolation screen` completion detection when status data is available.
- Treat `executed` with non-zero `exitCode` as a failed work session.
- Show an in-progress Telegram state while the command is running, not a success state or a terminal-looking state.
- Remove duplicate `Status: Executing...` text from the executing message.
- Remove the transient "This message will update when the session finishes" footer from final terminal messages.
- Update the original Telegram message after completion with success/failure and duration calculated from `$ --status` `startTime`/`endTime` when present.
- Ensure duplicate URL checks do not block on completed isolation sessions.
- Keep the regular non-isolation fallback behavior.
- Count executing isolated sessions in `/limits` and `/solve_queue`.
- Show processing as the maximum of tracked `$ --status` executing sessions and observed AI CLI processes.
- Preserve artifacts and analysis under `docs/case-studies/issue-1670`.
- Add automated tests for all testable logic.

## Root Causes

1. `isSessionRunning()` used `screen -ls` fallback even after `$ --status` returned a terminal status. That made screen socket state able to override `executed`.
2. Duplicate URL detection used in-memory tracking synchronously and did not refresh isolation session status before rejecting a retry.
3. Queue display counted only local `pgrep` results, so detached screen-isolated work could be undercounted.
4. Start messages used a success checkmark and "started successfully", which confused task startup with task completion.
5. After PR #1671, the direct Telegram command path and queued solve path still had duplicated executing-message templates. Both templates kept `Status: Executing...` and the transient footer.
6. Completion notifications still measured duration from the bot's local observation time, not the persisted `startTime`/`endTime` fields from `$ --status`.

## Implemented Solution

- Added tolerant `$ --status` parsing for JSON and text formats, including `status`, `exitCode`, and timestamps.
- Made terminal statuses authoritative; `screen -ls` fallback is now used only when `$ --status` has no usable status record.
- Added async active-session checks that refresh isolation status before blocking duplicate URLs.
- Added executing-isolation counts grouped by tool and used them in queue status with `max(statusCount, pgrepCount)`.
- Updated Telegram start/update messages to show `Executing...` until the session monitor publishes the final state.
- Centralized executing and completion message formatting in `src/work-session-formatting.lib.mjs` so direct `/solve` or `/hive` messages and queued `/solve` messages stay consistent.
- Changed executing messages to the compact hourglass form without the duplicate status line or update footer.
- Changed completion messages to use `$ --status` `startTime`/`endTime` for duration when those fields are available, so the failed PR #1672 example reports `21m 7s` instead of the later polling observation time.
- Added tests in `tests/test-issue-1670-screen-status-monitoring.mjs`.

## Residual Notes

The non-isolation `start-screen` path still uses timeout-based duplicate protection because it does not have the same reliable task-status record. That fallback remains intentionally separate from the `--isolation screen` path.

The linked PR #1672 failure log ended with a Codex stream disconnect from the model service. That is a separate transient execution failure, not the root cause of this Hive Mind status-monitoring bug. The Hive Mind requirement is to surface that non-zero detached task result accurately once `$ --status` records it.
