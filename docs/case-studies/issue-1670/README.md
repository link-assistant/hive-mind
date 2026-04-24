# Issue 1670 Case Study: Solve Completion Status Monitoring

## Source Artifacts

- Issue metadata: `issue-details.json`
- Issue comments: `issue-comments.json`
- PR metadata: `pr-1671-details.json`
- PR discussion snapshots: `pr-1671-conversation-comments.json`, `pr-1671-review-comments.json`
- Reported screenshots:
  - `stale-session-error.png`
  - `retry-started-message.png`

## External Research

- GNU Screen documents detached/background sessions and `screen -ls` listing behavior: https://www.gnu.org/software/screen/manual/screen.html
- Node.js `child_process` documentation describes process execution APIs used by the existing helper layer: https://nodejs.org/api/child_process.html

The relevant finding is that `screen -ls` describes screen socket state, not the higher-level `solve` task result. For `--isolation screen`, start-command's `$ --status <session>` is the task-status authority when it returns a concrete status such as `executing` or `executed`.

## Timeline

1. A user ran `/codex https://github.com/xlabtg/Teleton-Client/pull/2 --think max`.
2. The bot rejected the retry with "A working session is already running for this URL" and referenced session `77cf7b88-2fbf-48ef-85f2-7c2b2ce00763`.
3. Manual `$ --status 77cf7b88-2fbf-48ef-85f2-7c2b2ce00763` showed the underlying command had `status executed` and `exitCode 1`.
4. The Telegram message still showed "Solve command started successfully!" instead of a terminal failed/completed status.
5. A later retry started again under the same screen-isolation session name, demonstrating that `$ --status` can be used to distinguish executing work from completed work.

## Requirements Extracted

- Use `$ --status` for `--isolation screen` completion detection when status data is available.
- Treat `executed` with non-zero `exitCode` as a failed work session.
- Show an in-progress Telegram state while the command is running, not a success state.
- Update the original Telegram message after completion with success/failure and duration.
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

## Implemented Solution

- Added tolerant `$ --status` parsing for JSON and text formats, including `status`, `exitCode`, and timestamps.
- Made terminal statuses authoritative; `screen -ls` fallback is now used only when `$ --status` has no usable status record.
- Added async active-session checks that refresh isolation status before blocking duplicate URLs.
- Added executing-isolation counts grouped by tool and used them in queue status with `max(statusCount, pgrepCount)`.
- Updated Telegram start/update messages to show `Executing...` until the session monitor publishes the final state.
- Added tests in `tests/test-issue-1670-screen-status-monitoring.mjs`.

## Residual Notes

The non-isolation `start-screen` path still uses timeout-based duplicate protection because it does not have the same reliable task-status record. That fallback remains intentionally separate from the `--isolation screen` path.
