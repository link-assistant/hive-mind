# Case study: issue #2395 — `🔁 Session stopped: repeated tool call` was never a requirement

- Issue: https://github.com/link-assistant/hive-mind/issues/2395
- Pull request with the fix: https://github.com/link-assistant/hive-mind/pull/2396
- Affected runs (both `solve v2.33.1`, `--tool codex`, Codex CLI 0.159.0, `--auto-merge`):
  - [link-assistant/agent#323](https://github.com/link-assistant/agent/pull/323) (issue #320). The session was killed while it waited for CI. The run ended with "🚨 Solution Draft Failed" and "🛑 Automation stopped".
  - [konard/p-vs-np#623](https://github.com/konard/p-vs-np/pull/623) (issue #567). The session was killed while it waited for CI. The pull request was then auto-merged **without** `Fixes #567`, and issue #567 stayed open.

## Summary

The repeated-tool-call breaker (#2247, extended to every tool in #2316) was always on. It stopped a session after 3 identical tool calls that failed. "Failed" meant a non-zero exit code. "Identical" was decided by the command text only.

Codex polls CI with `gh pr checks <n>`. That command exits with code **8** while checks are pending ([gh manual](https://cli.github.com/manual/gh_pr_checks): _"Additional exit codes: 8: Checks pending"_) and with 1 when a check failed. So three ordinary polls were enough to kill a session that was doing exactly what it was asked to do: wait for CI.

In the p-vs-np run, three more defects turned the stop into a wrong merge:

| #   | Root cause                                                                                                                                                                                                                                                                                                    | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RC1 | The breaker was **always on** with a limit of **3**. It counted failures by command text only, so polling `gh pr checks` (exit 8 = pending) tripped it on the 3rd poll in both runs.                                                                                                                          | The breaker is opt-in (`--detect-repeated-tool-calls` / `HIVE_MIND_DETECT_REPEATED_TOOL_CALLS=true`) with a default limit of **10**. CI polling commands (`gh pr checks`, `gh run view`/`watch`, `gh pr view … statusCheckRollup`, `sleep`, …) are never counted, even when the breaker is enabled. A failing call only counts as a repeat when its output repeats too. The change applies to every tool: claude, codex, opencode, agent, gemini and qwen. |
| RC2 | `--auto-merge` treated a breaker stop as a tool failure. In agent#323 it reported "🚨 Solution Draft Failed" and stopped the automation, although the work was fine and CI was still running.                                                                                                                 | When the breaker is enabled and stops a session, the auto-merge loop continues with feedback (`restartWithFeedback`) instead of failing.                                                                                                                                                                                                                                                                                                                   |
| RC3 | Nothing checked the issue link **right before the merge**. hive-mind restored `Fixes #567` at 20:08:25. At 20:10:37 the description was rewritten without it, and the merge at 20:11:31 used the description as it was (`closingIssuesReferences: []`).                                                       | Both auto-merge paths (`solve.auto-merge.lib.mjs` and `solve.auto-merge-attempt.lib.mjs`) call `ensureIssueLinkBeforeMerge` immediately before `mergePullRequest`. It restores the link when it is missing. If the link cannot be read or written, the merge is held back (`issue_link_unverified`) and an "auto-merge blocked" comment explains how to fix the description.                                                                               |
| RC4 | The full log was attached once, at 20:08:58. The CI wait and the merge that followed were never published. Nothing re-attached a log when the merge went wrong.                                                                                                                                               | When the auto-merge is held back for any blocker, the full session log is attached again (`attachLogAfterAutoMergeBlocked`). This is in addition to the #2306 re-upload after post-solve restart loops. Since #2563 the log is not uploaded again when no AI session finished after the latest attached log.                                                                                                                                               |
| RC5 | **Unconfirmed.** It is not known who rewrote the description at 20:10:37 (see [below](#who-rewrote-the-description-at-201037)). Codex runs its tool commands in their own session (`setsid`), so they survive the kill of the Codex process group. The log could not show whether anything was still running. | Diagnostic only, so it does not interfere with legitimate work: with `--verbose`, every finished AI session logs the processes still running in its work directory (`src/session-survivors.lib.mjs`).                                                                                                                                                                                                                                                      |

## Data

Everything used for this study is in [`raw/`](./raw). In the two logs the Codex telemetry account email and account id are replaced with `[REDACTED_…]`.

| File                                                                                           | Content                                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [`hive-mind-log-N8APcJ-sanitized.log.txt.gz`](./raw/hive-mind-log-N8APcJ-sanitized.log.txt.gz) | Full log of the agent#323 run (from [gist 6734dd6d](https://gist.github.com/konard/6734dd6dd7f871aeab52725b3e440421))                         |
| [`hive-mind-log-wv1oqj-sanitized.log.txt.gz`](./raw/hive-mind-log-wv1oqj-sanitized.log.txt.gz) | Full log of the p-vs-np#623 run (from [gist 79efb10c](https://gist.github.com/konard/79efb10c028626561294ee7313674364)). It ends at 20:08:58. |
| `agent-pr323.json`, `agent-pr323-comment-*.json`                                               | agent#323 and its three comments (🔁, 🚨, 🛑)                                                                                                 |
| `p-vs-np-pr623.json`                                                                           | p-vs-np#623 after the merge, including `closingIssuesReferences: []`                                                                          |
| `p-vs-np-pr623-comments.json`, `p-vs-np-pr623-comment-*.json`                                  | p-vs-np#623 comments (🔁, ⚠️ Finished with Errors, 🎉 Auto-merged)                                                                            |
| `p-vs-np-pr623-edits.json`                                                                     | Edit history of the p-vs-np#623 description (GraphQL `userContentEdits`)                                                                      |
| `p-vs-np-pr623-timeline.json`                                                                  | Timeline events of p-vs-np#623 (ready for review, merged, …)                                                                                  |
| [`hive-mind-issue-2395.md`](./raw/hive-mind-issue-2395.md)                                     | Text of this issue                                                                                                                            |
| [`replay-gh-pr-checks-polling.txt`](./replay-gh-pr-checks-polling.txt)                         | Output of the replay experiment, before and after the fix                                                                                     |

The exact `gh pr checks` records from both logs are test fixtures:

- `tests/fixtures/issue-2395-agent-gh-pr-checks.jsonl`
- `tests/fixtures/issue-2395-p-vs-np-gh-pr-checks.jsonl`

The description that p-vs-np#623 was merged with is in `tests/fixtures/issue-2395-p-vs-np-pr623-body-at-merge.md`.

## Timeline (UTC, 2026-09-29)

### link-assistant/agent#323

| When     | Event                                                                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 17:39:07 | `solve` v2.33.1 starts for link-assistant/agent#320 with `--tool codex --auto-merge`.                                                                                        |
| 18:32:41 | The work session is done. The auto-merge loop ("restart until mergeable") starts a Codex session to wait for CI.                                                             |
| 18:40:06 | `gh pr checks 323` → exit 0                                                                                                                                                  |
| 18:40:57 | `gh pr checks 323` → exit 8 (pending) — failure #1 for the breaker                                                                                                           |
| 18:41:49 | `gh pr checks 323` → exit 8 (pending) — failure #2                                                                                                                           |
| 18:42:34 | `gh pr checks 323` → exit 1 (a check failed) — failure #3. The same command text failed 3 times, so the **breaker trips**.                                                   |
| 18:42:35 | Codex is killed and exits with code 143 (SIGTERM).                                                                                                                           |
| 18:42:36 | [🔁 Session stopped: repeated tool call](https://github.com/link-assistant/agent/pull/323#issuecomment-5896427734)                                                           |
| 18:43:06 | [🚨 Solution Draft Failed](https://github.com/link-assistant/agent/pull/323#issuecomment-5896435509) with the full log (gist 6734dd6d)                                       |
| 18:43:09 | [🛑 Automation stopped: the AI session failed](https://github.com/link-assistant/agent/pull/323#issuecomment-5896436158). The pull request stays open; CI was still running. |

### konard/p-vs-np#623

| When     | Event                                                                                                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 19:22:49 | `solve` v2.33.1 starts for konard/p-vs-np#567 with `--tool codex --auto-merge`.                                                                                                                                    |
| 19:23:32 | Draft pull request #623 is created with `Fixes #567`.                                                                                                                                                              |
| 19:50:52 | Codex writes `/tmp/issue567-pr-body.md`.                                                                                                                                                                           |
| 19:59:48 | Codex runs `gh pr edit 623 --body-file …`. The new description has only "Refs #567 and #568." — `Fixes #567` is gone.                                                                                              |
| 20:06:51 | `gh pr checks 623` → exit 8 (pending) — failure #1 for the breaker                                                                                                                                                 |
| 20:07:03 | Codex starts `gh run watch 36623953752 --exit-status` in a background PTY session (session 20369).                                                                                                                 |
| 20:07:35 | `gh pr checks 623` → exit 8 — failure #2                                                                                                                                                                           |
| 20:08:19 | `gh pr checks 623` → exit 8 — failure #3. The **breaker trips**. Codex exits with code 143 at 20:08:19.825.                                                                                                        |
| 20:08:20 | [🔁 Session stopped: repeated tool call](https://github.com/konard/p-vs-np/pull/623#issuecomment-5897797370)                                                                                                       |
| 20:08:25 | hive-mind's own check restores `Fixes #567` ("✅ Updated PR body to include "Fixes #567"").                                                                                                                        |
| 20:08:28 | The "Changes" section is regenerated.                                                                                                                                                                              |
| 20:08:32 | The pull request is marked ready for review.                                                                                                                                                                       |
| 20:08:58 | [⚠️ Solution Draft Finished with Errors](https://github.com/konard/p-vs-np/pull/623#issuecomment-5897808960) with the full log (gist 79efb10c). **The attached log ends here.**                                    |
| 20:10:37 | The description is rewritten. It is the 19:59:48 description plus "passed all seven jobs on commit `e829f09`", **without** `Fixes #567`. The edit is attributed to `konard`, the account that all automation uses. |
| 20:11:31 | The pull request is merged by the auto-merge. `closingIssuesReferences` is empty.                                                                                                                                  |
| 20:11:33 | 🎉 Auto-merged. Issue #567 stays **open**.                                                                                                                                                                         |

## Requirements from the issue

| #   | Requirement                                                                                        | Status                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Never interfere with legitimate tool calls; waiting for CI must keep working.                      | Done. CI polling is never counted (RC1), and a breaker stop no longer fails the auto-merge (RC2).                                                                                                    |
| R2  | Disable the repeated-tool-call detection by default; enable it only with an option.                | Done. `--detect-repeated-tool-calls` / `HIVE_MIND_DETECT_REPEATED_TOOL_CALLS`, default `false`, for all six tools.                                                                                   |
| R3  | Change the default limit from 3 to 10.                                                             | Done. `--repeated-tool-call-limit` defaults to 10.                                                                                                                                                   |
| R4  | A pull request must never be left unattached to its issue, "even if something fails".              | Done. The gate runs right before every auto-merge and fails closed (RC3).                                                                                                                            |
| R5  | When something fails, the full log must be attached at all places.                                 | Done. A held-back merge re-attaches the log (RC4). Existing guarantees stay: the first upload, `attachFinalLogIfMissing`, and the #2306 re-upload after restart loops.                               |
| R6  | Collect all logs and data in `docs/case-studies/issue-2395`.                                       | Done. See [Data](#data).                                                                                                                                                                             |
| R7  | Deep case study: timeline, requirements, root causes, solutions, existing libraries, online facts. | This document.                                                                                                                                                                                       |
| R8  | When the root cause cannot be found, add debug output / verbose mode.                              | Done for RC5: the `--verbose` survivor-process report.                                                                                                                                               |
| R9  | Report issues in other repositories where relevant.                                                | Checked; nothing to report. See [Upstream](#upstream-projects).                                                                                                                                      |
| R10 | Apply fixes everywhere the problem exists.                                                         | The breaker change covers all six tool integrations. The merge gate covers both auto-merge paths. Survivor reporting covers the first session and every restart iteration (`classifySessionResult`). |

## Root-cause analysis

### RC1 — the breaker counted CI polling as a loop

`createToolCallLoopGuard` (v2.33.x) keyed failures on the tool input only. `gh pr checks` fails by design while checks are pending: exit 8 is documented as "checks pending". Exit 1 is used when any check failed, including a flaky job that is re-run.

Codex marks every non-zero exit as a failed `command_execution`. Three polls, about 45 seconds apart, therefore looked like "an identical tool call repeated 3 times, failing every time".

[`experiments/replay-gh-pr-checks-polling-2395.mjs`](../../../experiments/replay-gh-pr-checks-polling-2395.mjs) feeds the exact records from both logs into the guard. The output is [`replay-gh-pr-checks-polling.txt`](./replay-gh-pr-checks-polling.txt):

```
# Before the fix (v2.33.2: breaker always on, limit 3, input-only counting)
issue-2395-p-vs-np-gh-pr-checks.jsonl limit=default: TRIPPED on poll 3
issue-2395-agent-gh-pr-checks.jsonl   limit=default: TRIPPED on poll 3

# After the fix (this pull request)
issue-2395-p-vs-np-gh-pr-checks.jsonl limit=default: not tripped
issue-2395-p-vs-np-gh-pr-checks.jsonl limit=3: not tripped
issue-2395-agent-gh-pr-checks.jsonl   limit=default: not tripped
issue-2395-agent-gh-pr-checks.jsonl   limit=3: not tripped
```

### RC2 — a breaker stop ended the auto-merge

`classifySessionResult` turned the breaker stop into `restartWithFeedback` in the first session. The auto-merge loop, however, looked only at `success === false` and reported a tool failure ("🚨 Solution Draft Failed", "🛑 Automation stopped"). Now the loop continues with feedback, like the first session does.

### RC3 — the issue link was checked too early

hive-mind ensures `Fixes #N` after each session (`ensurePullRequestIssueLink`). It did so correctly at 20:08:25.

The merge, two minutes later, did not look again. Any edit in between was trusted, whether from the AI, a leftover process, or a person. Neither GitHub nor hive-mind blocks a merge of a pull request that has no closing reference.

The fix moves the check to the last possible moment, right before `gh pr merge`, in both auto-merge paths. The check fails closed:

- If the description can be read and the link is missing, the link is restored and the merge proceeds.
- If the description cannot be read or written, or the check throws, the merge is held back with `issue_link_unverified`.

### RC4 — the log did not cover the end of the run

The log was uploaded at 20:08:58, when the solve phase ended with errors. The CI wait and the merge after it were never published. For a held-back merge — exactly the case a human has to investigate — no new log was produced.

`attachLogAfterAutoMergeBlocked` now uploads the full log again whenever the auto-merge loop returns `mergeBlockers`. Upload errors are logged and never escape.

### Who rewrote the description at 20:10:37?

This could not be determined from the available data:

- **The edit itself.** The description history (`p-vs-np-pr623-edits.json`) shows the edit as `konard`. That is the token all automation uses, so the author account says nothing. The new text is the 19:59:48 Codex description plus "passed all seven jobs on commit `e829f09`". That fact was only known after the CI run that Codex was watching had finished, which happened after the stop.
- **No visible session.** The uploaded log ends at 20:08:58 and has no restart iteration. Within the log no hive-mind-controlled session was running at 20:10:37.
- **Survivors are possible.** Codex starts shell-tool commands with `detach_from_tty()`, which calls `setsid()` ([openai/codex PR #9477](https://github.com/openai/codex/pull/9477), explained in [this article on Codex and suspended TTY input](https://lilting.ch/en/articles/codex-suspended-tty-input-mcp)). Those commands live in their own session and process group. hive-mind runs Codex through command-stream with `detached: true` and kills the process group `-pid`; command-stream 1.3.0 escalates to SIGKILL after a grace period. Commands in their own session are not in that group and survive. The `gh run watch` started at 20:07:03 is such a command, but by itself it cannot write a new description.

So the candidates are:

1. a Codex or model process that survived the stop and still had the finished CI result,
2. a session that was not logged, or
3. a manual edit.

The fix for RC3 makes the outcome safe in every case. To find the actual cause next time, `--verbose` now logs every process still running in the work directory after each session ends:

```
⚠️  1 process(es) still running in /tmp/gh-issue-solver-… after the session ended:
   pid 4242: /bin/bash -lc 'gh run watch 36623953752 --repo konard/p-vs-np --exit-status'
```

Killing such processes automatically was deliberately **not** added. It would interfere with legitimate background work, which is exactly what this issue asks to avoid. Whether to add it can be decided once the diagnostic shows real survivors.

## Existing components and online facts

- **gh exit codes.** [`gh pr checks`](https://cli.github.com/manual/gh_pr_checks) documents exit code 8 for pending checks, and [`gh run watch --exit-status`](https://cli.github.com/manual/gh_run_watch) blocks until the run is done. A wait loop built on these commands is legitimate and expected to repeat; hive-mind's own `--auto-merge` CI wait uses the same signals.
- **Codex process model.** As described under RC5, shell-tool commands run under `setsid()` ([openai/codex PR #9477](https://github.com/openai/codex/pull/9477)). Killing the Codex process group therefore does not reliably stop them.
- **command-stream.** command-stream 1.3.0, the version the run used, spawns with `detached: true` and kills both the pid and the process group. It escalates to SIGKILL after a grace period (`scheduleForcefulEscalation`). That is sufficient for Codex itself, but cannot reach processes that started their own session.
- **Linux `/proc`.** `/proc/<pid>/cwd` and `/proc/<pid>/cmdline` are enough to find leftovers by work directory, without new dependencies. The survivor report reads them and is a no-op where `/proc` is missing.

## Upstream projects

- **cli/cli (gh).** Exit code 8 for pending checks is documented, intended behaviour. Nothing to report.
- **openai/codex.** Running shell commands under `setsid()` is an intentional design that fixes TTY suspension (PR #9477). The side effect, that tool commands outlive a killed Codex, matters only to wrappers that kill Codex. There is not yet evidence that a survivor caused the 20:10:37 edit, so filing an issue now would not be reproducible. If the new `--verbose` report shows survivors, an issue to openai/codex can include that output, with a suggestion to kill the tool sessions when `codex exec` receives SIGTERM.
- **command-stream.** Behaves as documented. Nothing to report.

## Remaining uncertainty

- The author of the 20:10:37 description edit (RC5). The merge gate makes it harmless, and the verbose report will identify a leftover process if one is involved.
- The agent#323 run cannot be replayed end to end. The replay covers the exact breaker decisions, and the unit tests cover the auto-merge branch.
