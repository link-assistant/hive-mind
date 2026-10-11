# Case Study: `/merge` stopped with "Error: Error: Cannot start merge queue: CI on main is still running" (Issue #2925)

- **Issue:** [#2925](https://github.com/link-assistant/hive-mind/issues/2925)
- **Pull request:** [#3012](https://github.com/link-assistant/hive-mind/pull/3012)
- **Affected version:** `@link-assistant/hive-mind` 2.35.x (Telegram bot `/merge`)
- **Evidence in this folder:**
  - [`screenshot.png`](screenshot.png) shows the Telegram message from the issue.
  - [`home-box-hive-telegram-bot.log.txt`](home-box-hive-telegram-bot.log.txt) is the full verbose bot log of the incident (69,901 lines).
  - [`ci-logs/run-37983302098.json`](ci-logs/run-37983302098.json) and [`ci-logs/run-37983302098-jobs.json`](ci-logs/run-37983302098-jobs.json) are the main-branch "Checks and release" run the queue waited for.
  - [`ci-logs/run-37983302098-failed.log`](ci-logs/run-37983302098-failed.log) holds the failed job logs of that run.

## 1. What the user saw

`/merge https://github.com/link-assistant/hive-mind` for one PR labelled `ready` (#2802) ended with:

```
⚠️ Error: Error: Cannot start merge queue: CI on main is still running after waiting
(Checks and release); cannot confirm main is green. Please run /merge again once CI finishes.
```

The final report still showed the PR as ⏳ pending, with `⏭️ Skipped: 0`. Nothing told the user whether main was broken, what they should do, or that the planned merge would not happen.

## 2. Timeline (UTC, 2026-10-09)

| Time         | Event                                                                                                                                                                                      | Source                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 19:53:31     | PR #2772 merged into `main` as `fdff413`. The push triggers `Checks and release` (run 37983302098), `Broken Link Checker` and `Security`.                                                  | `run-37983302098.json` (`created_at`, `head_sha`) |
| ≈19:53       | `/merge` received. The branch gate (round 1/10, before PR #2802) finds 3 runs on `fdff413`, all **`queued`**.                                                                              | bot log L41294, L41334–41347                      |
| 19:53–20:18  | No runner picks up `Checks and release`. Its first real job (`Release Preflight`) starts at 20:18:03, about 25 minutes after the run was created, and `detect-changes` starts at 20:25:31. | `run-37983302098-jobs.json`                       |
| ≈20:39–20:40 | `TARGET_BRANCH_CI_TIMEOUT_MS` (45 min) expires. `Broken Link Checker` and `Security` finished (`completedRuns=2`), but `Checks and release` is still listed as `queued`.                   | bot log L57570–57571                              |
| ≈20:40       | The gate returns `status: 'pending'`. `failQueue()` sends the message above. The remaining item stays `pending` and `Skipped: 0`.                                                          | bot log L57589–57596                              |
| 21:02–21:08  | The `Release` job publishes 2.35.1, then post-publish verification polls npm 15 × 30 s (`not visible yet (check 14 of 15)`, `E404`) and fails.                                             | `run-37983302098-failed.log` L3157–3185           |
| 21:17:15     | The run completes with **`conclusion: failure`**, so `main` really is red, which was the issue author's follow-up observation ("CI/CD failed on main").                                    | `run-37983302098.json`                            |

## 3. Requirements from the issue

| #   | Requirement                                                                                                                                                      | Where it is addressed                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | "Our merge queue must work perfectly."                                                                                                                           | §5: root causes RC1–RC4 fixed and covered by regression tests                                                                                           |
| R2  | "As CI/CD failed on main, we should stop, and show all planned actions as skipped."                                                                              | `stopQueueOnBlockedBranch()` / `skipRemainingItems()`. Every remaining PR becomes ⏭️ skipped with a reason, and `Skipped: N` is counted.                |
| R3  | "Show an adequate message, that CI/CD on main (default) branch must be fixed first for /merge to work."                                                          | `buildBranchBlockedMessage()`                                                                                                                           |
| R4  | `/merge --auto-fix-ci-cd`                                                                                                                                        | `telegram-merge-command.lib.mjs` → `spawnFixCiCdSession()`. Dispatched by `dispatchAutoFixCiCd()` when the default branch is red.                       |
| R5  | `/solve`, `/codex`, `/claude`, … (all aliases) `--fix-ci-cd` must behave like `/fix --ci-cd` for a repository link or its issues listing (no specific issue id). | `extractFixCiCdFlag()`, `buildFixCiCdArgsFromSolve()`, `handleFixCiCdFromSolve()` in `telegram-fix-command.lib.mjs`, wired in `handleSolveCommand`      |
| R6  | Collect logs and data in `docs/case-studies/issue-2925`, and write a deep analysis.                                                                              | This folder                                                                                                                                             |
| R7  | Add debug output where needed.                                                                                                                                   | The gate logs every run still pending after the timeout (name, status, created time, URL), and the queue logs the skip count and the auto-fix dispatch. |
| R8  | Report upstream issues where relevant.                                                                                                                           | §7                                                                                                                                                      |

## 4. Root causes

### RC1: Main CI waited in the runner queue longer than the merge gate's timeout

`Checks and release` sat `queued` for about 25 minutes before its first job started, because the organization's runners were congested by many concurrent sessions. GitHub queues jobs that exceed the account's concurrent-job limit instead of rejecting them ([GitHub Docs: Actions limits](https://docs.github.com/en/actions/reference/limits)). The run as a whole took 84 minutes (19:53 → 21:17), so the 45-minute `TARGET_BRANCH_CI_TIMEOUT_MS` could not see it finish. The gate was _right_ to refuse to merge, because it could not prove `main` was green, and in fact `main` turned out red. The problem was what happened next (RC3, RC4).

### RC2: The release job failed on npm propagation lag (already fixed upstream)

The `Release` job published 2.35.1, then gave up after 15 × 30 s (≈330 s) because the registry still returned `E404`. npm exposed the version after 874 s. That made `main` red although nothing was wrong with the code. This was fixed separately in #2923 (commit `d565998e`), where the verification window is now 25 minutes. It is listed here because it is why the user saw a red main afterwards.

### RC3: `failQueue()` left the planned merges as "pending"

`MergeQueueProcessor.run()` called `failQueue(message)` as soon as the branch gate returned `ok: false`, and `failQueue` only set the queue status. Items that were never attempted kept `MergeItemStatus.PENDING`, so the final report rendered them as ⏳ and printed `⏭️ Skipped: 0`. The same was true when post-merge CI of a just-merged PR failed (`stopOnPostMergeCIFailure`).

### RC4: The error message was both doubled and hidden

- `onError` received a plain `Error`. With `--verbose`, `formatUserError()` returned `` `Error: ${message}` ``, and the handler then rendered `⚠️ Error: ${text}`, which gave `Error: Error:`.
- Without `--verbose`, the actionable explanation was replaced by a generic "An error occurred" text, so the reason was invisible to most users.
- The text itself ("CI on main is still running … Please run /merge again once CI finishes") did not say that `/merge` requires a green default branch, nor how to fix a red one.

### RC5: No way to go from a red main to a fix in one step

`/fix <repo> --ci-cd` existed, but `/merge` could not trigger it. The solve aliases (`/codex`, `/claude`, …) could not be used for it either, even though they are what users type most.

## 5. Solution

### 5.1 Stop cleanly and mark everything skipped (RC3, R2)

New module [`src/telegram-merge-blocked-branch.lib.mjs`](../../../src/telegram-merge-blocked-branch.lib.mjs):

- `skipRemainingItems(processor, fromIndex, reason)` marks every still-pending PR as `skipped`, stores a short reason (≤ 50 chars, the report's truncation width), and increments `stats.skipped`.
- `stopQueueOnBlockedBranch(processor, gate, …)` is used by `run()` for both "cannot start" (index 0) and "stopped before PR #N" (later rounds). It skips, logs, optionally dispatches `/fix --ci-cd`, and fails the queue with the message below.
- Post-merge CI failure now also skips the rest with `post-merge CI of #N failed`.

### 5.2 An adequate message (RC4, R3)

`buildBranchBlockedMessage()` produces, for the production case (`pending` after the wait):

> Cannot start merge queue: CI/CD on the default branch main did not finish within 45 min (still running: Checks and release (queued)), so it cannot be confirmed green. /merge only merges on top of a green default branch. All 1 planned merge was skipped. Run /merge again once CI on main finishes; if it fails, CI/CD on main must be fixed first (/fix --ci-cd https://github.com/link-assistant/hive-mind).

and for a red default branch:

> Cannot start merge queue: CI/CD on the default branch main is failing (1 CI run(s) failed on main: Checks and release). CI/CD on the default branch must be fixed first for /merge to work. All 3 planned merges were skipped. Fix it with /fix --ci-cd https://github.com/link-assistant/hive-mind (or add --auto-fix-ci-cd to /merge to start that automatically), then run /merge again.

The queue now passes a `MergeQueueUserError` (`userFacing = true`) to `onError`. `formatUserError()` shows such messages as-is, also without `--verbose`, and no longer prefixes `Error:` in verbose mode. The final report lists runs still pending on the default branch, each with a link to GitHub Actions.

### 5.3 `/merge --auto-fix-ci-cd` (RC5, R4)

When the flag is set and the gate reports `failed` (a red default branch), the queue calls `spawnFixCiCdSession({ owner, repo, url, branch })`, which runs `fix <repository-url> --ci-cd` in a work session, the same as typing `/fix <repo> --ci-cd`. The outcome (session name or error) is shown in the message and the final report. It is **not** triggered for `pending`, because a slow but possibly green CI does not need fixing. If `/fix` is disabled on the bot instance, the flag is rejected up front.

### 5.4 `--fix-ci-cd` on `/solve` and every alias (RC5, R5)

`handleSolveCommand` strips `--fix-ci-cd` (`extractFixCiCdFlag`) before solve validation, applies the alias tool (`/codex` → `--tool codex`), and hands the arguments to `handleFixCiCdFromSolve`. That handler:

- accepts a repository URL, `owner/repo`, or the repository's `/issues`, `/pulls` or `/actions` listing URL;
- rejects a specific issue or PR with an explanation (`/fix --ci-cd` works on a whole repository);
- forwards every other option (`--model`, `--think`, `--tool`, …) exactly like `/fix`;
- goes through the same authorization, isolation and session start path as `/fix` (`startFixSession`).

So `/codex https://github.com/owner/repo/issues --fix-ci-cd` ≡ `/fix https://github.com/owner/repo --tool codex --ci-cd`.

### 5.5 Debug output (R7)

- The branch gate logs each run still pending after the timeout: `still pending on main: Checks and release status=queued created=… (url)`.
- The queue logs `Branch gate blocked the queue (status=…, branch=…); skipped N PR(s)` and the `--auto-fix-ci-cd` dispatch result.
- All of it is only visible with `--verbose`, which is the existing logging switch.

## 6. Tests

- [`tests/test-merge-blocked-by-main-ci-2925.mjs`](../../../tests/test-merge-blocked-by-main-ci-2925.mjs) has 20 cases:
  - a replay of the production timeline (queued main CI, wait timeout);
  - red main at start and between PRs;
  - post-merge CI failure;
  - `--auto-fix-ci-cd` (red, pending, spawn failure, off);
  - `formatUserError`;
  - `--auto-fix-ci-cd` parsing and `spawnFixCiCdSession`;
  - `--fix-ci-cd` extraction and target validation for every solve alias;
  - the `/codex …/issues --fix-ci-cd` → `fix` session handoff.
- [`tests/test-merge-red-main-after-wait-2404.mjs`](../../../tests/test-merge-red-main-after-wait-2404.mjs) was updated: unprocessed PRs are now expected to be `skipped`, not `pending`.

## 7. Upstream / external factors

- **GitHub Actions queueing (RC1)** is documented behavior: jobs over the concurrency limit wait in the queue, and self-hosted jobs can wait up to 24 h ([Actions limits](https://docs.github.com/en/actions/reference/limits)). There is nothing to report upstream. The bot now explains the situation instead of failing opaquely.
- **npm propagation lag (RC2)** is an eventual-consistency property of the registry, already handled in #2923. No new upstream report.
- No defect was found in a third-party library, so no upstream issue was filed.

## 8. Existing tools and prior art

- **GitHub merge queue** tests each PR on top of the latest target branch plus the PRs ahead of it, and removes PRs whose required checks fail ([GitHub Docs: Managing a merge queue](https://docs.github.com/en/enterprise-server@3.17/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)). It requires `merge_group` triggers in the workflows and branch protection on the target branch. Hive Mind's `/merge` runs for arbitrary repositories without those settings, so it keeps its own queue.
- **Mergify** lets teams _pause_ all merge queues during a CI incident: PRs can still enter, but nothing is merged until the queue resumes ([Mergify: Pausing the Merge Queue](https://docs.mergify.com/merge-queue/pause)). It also describes freezing the queue automatically after a deploy failure ([Mergify blog](https://mergify.com/blog/deploy-failure-freezes-merge-queue)). That is the same principle as this fix: do not merge onto a red base, say why, and resume once it is green.
- **Bors-style merge bots** follow the "keep the main branch always green" rule: a change lands only after the merged result passes CI. `/merge` already waited for green before each merge. This issue was about what to tell the user, and which items to mark, when that precondition cannot be met.

## 9. Possible follow-ups (not in this PR)

- Make `TARGET_BRANCH_CI_TIMEOUT_MS` configurable per command (for example `/merge --branch-ci-timeout 90m`) for repositories whose release pipeline routinely takes more than 45 minutes.
- Let `--auto-fix-ci-cd` re-run `/merge` automatically once the fix PR is merged and the default branch is green.
