# Case study: issue #2809, "No OOM must be reported when Ready to merge is already submitted"

Issue: [#2809](https://github.com/link-assistant/hive-mind/issues/2809). Pull request: [#3531](https://github.com/link-assistant/hive-mind/pull/3531). Related: [#3435](https://github.com/link-assistant/hive-mind/issues/3435) (the kill notice must show the real recovery state), fixed in the same pull request.

## Data

| File                                                           | What it is                                                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`data/issue-2809.md`](data/issue-2809.md)                     | The issue text                                                                                  |
| [`data/pr-15-comments.png`](data/pr-15-comments.png)           | First screenshot from the issue: "Ready to merge", then the OOM comment, on leaderstat/koz-3#15 |
| [`data/telegram-completion.png`](data/telegram-completion.png) | Second screenshot from the issue: the Telegram completion message of the same session           |

leaderstat/koz-3 is a private repository and its execution log is not public, so the timeline below is rebuilt from the two screenshots.

## Timeline (2026-10-08, UTC)

| Time         | Event                                                                                                                                                                             | Source              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| ~11:03:48    | `/claude https://github.com/leaderstat/koz-3/issues/14` starts session `29d1aa53` in Docker with `--attach-logs` and `--on-session-kill=resume` (start = end − 4h 7m 11s)         | Telegram screenshot |
| 11:13:13.140 | The monitor sees a container OOM event (`State.OOMKilled = true`). A child process is killed; `solve` and Claude keep running. Nothing is posted.                                 | both screenshots    |
| 11:13–15:10  | The cgroup OOM killer fires again and again: at the end `memory.events` shows `oom=20` (limit reached) and `oom_kill=9` (processes killed), with a 2.9 GB limit and a 2.9 GB peak | Telegram screenshot |
| 15:10:58     | solve posts "## ✅ Ready to merge" on PR #15 (CI green, no conflicts, nothing uncommitted)                                                                                        | PR screenshot       |
| 15:10:59.712 | Last session readings (`solve_exit` phase); solve exits 0                                                                                                                         | both screenshots    |
| 15:11:15     | The monitor posts "ℹ️ Work session completed — an earlier container OOM event did not stop it" (marker `<!-- hive-mind:session-kill-notice -->`) below "Ready to merge"           | PR screenshot       |
| 15:11        | Telegram: "✅ Work session finished successfully", with "⚠️ recovered from out of memory" and the kill diagnostics, but no count of the 9 OOM kills                               | Telegram screenshot |

## Requirements

| #   | Requirement (from the issue)                                                                   | Status                | Where                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | No OOM comment on GitHub after "Ready to merge" (the work is finished)                         | Done                  | A session that finishes well no longer posts the completion notice: `src/session-monitor.lib.mjs:1090` calls `finishKillNotice` only for `killed` or `oomEventOnly`. A kill on a pull request that is merged, closed, or whose latest session said "Ready to merge" posts nothing on GitHub and starts no recovery: `pullRequestReportSkipReason` (`src/session-monitor.kill-sections.lib.mjs:104`), `resolveReadyToMerge` (`src/github-pr-state.lib.mjs:61`), `src/session-monitor.lib.mjs:1022` |
| R2  | OOM is reported on GitHub only when it happens, with the log so far when `--attach-logs` is on | Done                  | `reportSurvivedOomEvent` (`src/session-oom-event-report.lib.mjs:99`), called on each poll while the session runs (`src/session-monitor.lib.mjs:813`). One comment per session; skipped when the pull request is finished or solve already reported the killed process                                                                                                                                                                                                                             |
| R3  | After that, one comment about the recovery (resume or restart), like other cases               | Done (earlier, #3530) | A kill posts one notice with a pending note; the recovery posts its own start comment (`--session-type kill-resume\|kill-restart`). If the recovery fails as well, its outcome is added to the same notice (#3435, `src/session-kill-recovery-outcome.lib.mjs`)                                                                                                                                                                                                                                   |
| R4  | Telegram may keep reporting the OOM after the fact                                             | Done (kept)           | `formatKillRecoverySection` (`src/session-kill-diagnostics.lib.mjs:614`) still runs at completion; the live report also sends a short Telegram message                                                                                                                                                                                                                                                                                                                                            |
| R5  | Show the OOM count in Telegram when there was more than one                                    | Done                  | `countOomEvents` (`src/session-monitor.oom.lib.mjs:61`) counts the cgroup `oom_kill` counter; the count is persisted (`src/session-store.lib.mjs:130`) and inherited by recovery sessions; it is shown as "(9 OOM kills)" with the `recovered.count` key in all four `src/locales/*.lino` files                                                                                                                                                                                                   |
| R6  | Case study with data, timeline, requirements, root causes and solutions                        | Done                  | This file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| R7  | Debug output where data is missing                                                             | Done                  | `--verbose` logs a stale observation, the outcome of the live report (posted, or the reason GitHub was skipped), the pull request lookup failure, and `readyToMerge` in the completion evidence line (`src/github-pr-state.lib.mjs:135`)                                                                                                                                                                                                                                                          |
| R8  | Report issues in other repositories                                                            | Not needed            | The cause is in hive-mind; see [Upstream notes](#upstream-notes)                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Root causes

1. **The OOM was reported after the work, not when it happened (R1, R2).** At 11:13 the monitor only stored `oomEventObservedAt` (`markOomEventObserved`, `src/session-monitor.oom.lib.mjs:91`). The only GitHub report was built when the session ended: with exit 0 and an observed OOM, the completion path treated the session as `recovered` and still called `finishKillNotice`, which posted "Work session completed — an earlier container OOM event did not stop it". So the comment came four hours late, after "Ready to merge".
2. **"Ready to merge" was not seen as finished work (R1).** Only a merged pull request stopped the notice. The monitor never read the pull request's comments, solve does not log a line the monitor could use, and the `state` field (`closed`) was fetched but never read.
3. **No count (R5).** `formatKillRecoverySection` had no count, and an OOM event was recorded once per session, so the 9 kills (the `oom_kill` counter) were only visible inside the diagnostics line.

The cgroup v2 [`memory.events`](https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files) file explains the two numbers in the screenshot: `oom` counts how often the cgroup hit its limit and an allocation was about to fail (20), and `oom_kill` counts processes killed by the OOM killer (9). The kill count is the one users care about, so it is what Telegram shows. In this session Docker reported `State.OOMKilled = true` although the main process exited 0: the flag follows OOM kills in the container cgroup, not the fate of the main process, so the flag alone does not mean the session died.

## Solutions

1. **Report a survived OOM live, once** (`src/session-oom-event-report.lib.mjs`).
   - While the session is still running, the monitor calls `reportSurvivedOomEvent` on each poll (`src/session-monitor.lib.mjs:813`).
   - It waits `OOM_EVENT_REPORT_GRACE_MS` (30 s, about one poll) so that solve's own in-process report, if any, is written first.
   - It does not report an observation older than 15 minutes (`OOM_EVENT_REPORT_MAX_AGE_MS`), for example after a bot restart.
   - The GitHub comment carries the log so far with `--attach-logs` and is marked per session (`oomEventNoticeSessionMarker`).
   - The comment is skipped when the pull request is merged, closed or "Ready to merge", or when the session log already holds solve's `[HIVE-MIND RECOVERY]` kill record (`findInProcessKillReport`, `src/session-tool-exit.lib.mjs:63`).
   - Telegram always gets a short message that says why GitHub was skipped.
   - `oomEventReportedAt` is persisted, so a bot restart does not report the event again.
2. **No completion notice for a session that finished well.** `src/session-monitor.lib.mjs:1090` now calls `finishKillNotice` only when the session was killed (`killed`) or failed after an OOM event (`oomEventOnly`). Telegram keeps the "recovered from out of memory" section.
3. **"Ready to merge" and closed pull requests count as finished work.**
   - `isReadyToMergeCommentLatest` (`src/github-pr-state.lib.mjs:18`) is true when the newest "## ✅ Ready to merge" comment is newer than the newest session start comment. A later session start reopens the work.
   - `resolvePullRequestState` adds `readyToMerge` for an open pull request. The lookup can be injected and never throws. An unknown answer (`null`) is treated as "not ready", so a real kill is still reported.
   - `pullRequestReportSkipReason` returns `pull-request-merged`, `pull-request-closed` or `pull-request-ready-to-merge`. Any of these stops the GitHub notice and the recovery (`src/session-monitor.lib.mjs:1022`), and Telegram says why.
4. **Count the OOM kills.** `countOomEvents` adds the growth of the cgroup `oom_kill` counter. A lower reading means a new container, so it is added in full. Without a counter, each first observation counts as one. The count is inherited by recovery sessions; the once-only report fields are reset for them (`src/session-kill-resume.lib.mjs:296-299`).

## Tests

- `tests/issue-2809-oom-report-timing.test.mjs`:
  - "Ready to merge" detection;
  - a lookup that is injectable and never throws;
  - merged, closed and ready pull requests skip GitHub and the recovery;
  - end to end, exit 137 on a ready pull request posts nothing;
  - the live report is sent once, with the log, honours the grace period, and skips GitHub when solve already reported the kill;
  - end to end, the live report is posted on the first poll after the grace period, and only once;
  - the counter semantics;
  - the Telegram count in English and Russian.
- `tests/issue-2498-merged-pr-recovery.test.mjs`: an open pull request with exit 0 after an OOM now gets 0 comments and 0 uploads; Telegram still says "recovered from out of memory".
- `tests/test-issue-2134-killed-session-recovery.mjs`: the OOM-survived run posts no `gh pr comment`.
- `tests/issue-3435-kill-notice-state.test.mjs`: the monitor posts no second notice when solve already reported the in-process kill.

## Remaining limits

- A session that ends within the 30-second grace period after the OOM event gets no live GitHub comment; Telegram still reports it at completion.
- The live Telegram OOM message is in English only; the completion section is localized.
- If a recovery runs in a new container whose `oom_kill` counter happens to equal the parent's last reading, those kills are not counted.
- "Ready to merge" is read from the pull request's comments. If the GitHub API is not reachable, the answer is unknown and a kill is reported as before.

## Upstream notes

No report was filed: the behaviour comes from hive-mind's own reporting. Docker's `State.OOMKilled` being true for a container whose main process survived is not a bug to report; hive-mind already treats it as "an OOM event", not as "the session was killed".
