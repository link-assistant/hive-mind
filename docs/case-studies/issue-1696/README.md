# Issue 1696 Case Study: Codex App-Server Stream Lag Warning Reported as Failed Solution Draft

Issue: https://github.com/link-assistant/hive-mind/issues/1696

Prepared PR: https://github.com/link-assistant/hive-mind/pull/1697

Upstream report: https://github.com/openai/codex/issues/19689

## Summary

PR #551 did not actually fail at the task level. The April 26, 2026 Codex session updated PR #551, pushed commit `85ee7d2d`, marked the PR ready for review, confirmed the worktree was clean, and reported passing local and GitHub Actions checks. After that successful final message, Hive Mind reported the run as failed because `executeCodexCommand()` treated every Codex `item.type="error"` as fatal.

The item-level error was a Codex app-server backpressure warning:

```json
{ "type": "item.completed", "item": { "id": "item_115", "type": "error", "message": "in-process app-server event stream lagged; dropped 133 events" } }
```

This warning appeared twice in the stream, but the same run still emitted a final `agent_message`, `turn.completed`, and exit code 0. The fix keeps real Codex structured errors fatal while ignoring only this exact non-fatal item-level app-server stream-lag warning.

## Source Artifacts

Raw GitHub and log evidence is saved in this directory:

| File                                             | Purpose                                                              |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `raw-data/issue-1696.json`                       | Issue metadata and full request                                      |
| `raw-data/issue-1696-comments.json`              | Issue comments, empty at capture time                                |
| `raw-data/pr-1697.json`                          | Prepared PR metadata                                                 |
| `raw-data/pr-551.json`                           | Incident PR metadata                                                 |
| `raw-data/pr-551-conversation-comments.json`     | PR #551 conversation comments, including the failed-solution comment |
| `raw-data/pr-551-review-comments.json`           | PR #551 inline review comments                                       |
| `raw-data/pr-551-reviews.json`                   | PR #551 reviews                                                      |
| `raw-data/pr-551-commits-files.json`             | PR #551 commits and changed files                                    |
| `raw-data/pr-551.diff.gz`                        | PR #551 diff snapshot                                                |
| `raw-data/related-issue-467.json`                | Original feature issue fixed by PR #551                              |
| `raw-data/related-issue-467-comments.json`       | Issue #467 comments                                                  |
| `raw-data/openai-codex-issue-19689.json`         | Upstream OpenAI Codex issue filed from this investigation            |
| `logs/pr-551-codex-failure-log.txt.gz`           | Full 85 MB failure log, gzip-compressed to 3 MB                      |
| `logs/pr-551-first-solution-draft-log.txt.gz`    | Earlier PR #551 solution-draft log from the December 2025 session    |
| `logs/pr-551-failure-log-head.txt.gz`            | Head excerpt from the April 26 failure log                           |
| `logs/pr-551-failure-log-tail.txt.gz`            | Tail excerpt from the April 26 failure log                           |
| `logs/pr-551-failure-log-keyword-matches.txt.gz` | Bounded keyword match evidence                                       |
| `logs/pr-551-failure-log-exit-matches.txt.gz`    | Bounded exit/error match evidence                                    |
| `logs/test-codex-support-before-fix.log.gz`      | Regression test failing before the code fix                          |
| `logs/test-codex-support-after-fix.log.gz`       | Same test passing after the code fix                                 |
| `research-sources.json`                          | Online and repository research sources                               |
| `openai-codex-upstream-issue.md`                 | Body of the upstream issue report                                    |

## Timeline

All times are UTC.

| Time             | Event                                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2025-10-14 15:12 | PR #551 was opened to add Telegram terminal watching for issue #467.                                                                                                                                                      |
| 2025-12-20 20:44 | First AI work session on PR #551 started.                                                                                                                                                                                 |
| 2025-12-20 21:04 | First solution-draft log was posted to PR #551 as a Gist.                                                                                                                                                                 |
| 2026-04-26 15:30 | The PR received updated requirements: use a separate `/terminal_watch` command, keep `--auto-start-screen-watch-message` experimental and disabled by default, and verify all comments and CI.                            |
| 2026-04-26 15:34 | A second Codex work session started for PR #551.                                                                                                                                                                          |
| 2026-04-26 15:34 | `solve v1.56.15` ran `codex` with `--attach-logs --verbose --auto-accept-invite --tokens-budget-stats --auto-attach-solution-summary`.                                                                                    |
| 2026-04-26 15:42 | Codex emitted two item-level app-server stream-lag events: dropped 133 events and dropped 96 events.                                                                                                                      |
| 2026-04-26 16:16 | Codex produced a final agent message saying PR #551 was updated and ready, commit `85ee7d2d` was pushed, local checks passed, GitHub Actions run `24961081768` passed, merge state was clean, and the worktree was clean. |
| 2026-04-26 16:16 | The JSON stream emitted `turn.completed` with usage data.                                                                                                                                                                 |
| 2026-04-26 16:16 | Hive Mind logged `Codex error events observed: item=2, turn=0, stream=0` and then failed the run on the first stream-lag item error.                                                                                      |
| 2026-04-26 16:16 | PR #551 received a "Solution Draft Failed" comment even though the underlying task had succeeded.                                                                                                                         |
| 2026-04-26 17:12 | Issue #1696 was opened to investigate and prevent repeat failures.                                                                                                                                                        |
| 2026-04-26       | This PR added a regression test, implemented the narrow non-fatal classification, saved the evidence, and filed OpenAI Codex issue #19689.                                                                                |

## Requirements Extracted from Issue 1696

| Requirement                                                                                                          | Status                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Download all logs and data related to the incident into `docs/case-studies/issue-1696`.                              | Done. GitHub metadata, PR diff, previous session log, full compressed failure log, excerpts, and test logs are saved.                                   |
| Reconstruct the timeline and sequence of events.                                                                     | Done in this README.                                                                                                                                    |
| List each requirement from the issue.                                                                                | Done in this section.                                                                                                                                   |
| Find root causes of each problem.                                                                                    | Done below.                                                                                                                                             |
| Propose solutions and solution plans for each requirement.                                                           | Done below.                                                                                                                                             |
| Check known existing components or libraries that solve or help solve the problem.                                   | Done in "Existing Components Considered."                                                                                                               |
| Search online for additional facts and data.                                                                         | Done; sources are in `research-sources.json`.                                                                                                           |
| If data is insufficient, add debug output or verbose mode for a future iteration.                                    | Not needed for root cause. The captured run already had `--verbose` and `RUST_LOG=debug`; the fix adds a verbose-only log when this warning is ignored. |
| If related to another GitHub project, report the issue with a reproducible example, workaround, and fix suggestions. | Done: OpenAI Codex issue #19689.                                                                                                                        |

## Root Cause Analysis

### Root Cause 1: Codex used an error-shaped item for a non-fatal warning

The captured stream contained:

```json
{"type":"item.completed","item":{"id":"item_115","type":"error","message":"in-process app-server event stream lagged; dropped 133 events"}}
{"type":"item.completed","item":{"id":"item_116","type":"error","message":"in-process app-server event stream lagged; dropped 96 events"}}
```

Those events were not terminal failures. Later evidence in the same log shows a final `agent_message`, `response.completed`, `turn.completed`, and exit status 0. The assistant's final message explicitly reported the PR was updated and ready.

OpenAI's app-server README distinguishes non-fatal runtime warnings from fatal error events. It documents generic runtime warnings as `warning` notifications, and fatal `error` events as mid-turn errors that may precede a failed turn. The observed `item.type="error"` stream-lag event sits between those concepts: it is shaped like an error item but behaved like a warning.

### Root Cause 2: Hive Mind had a broad fatal rule after issue #1660

Issue #1660 fixed a real false-success bug: Codex could emit top-level `type="error"` and `turn.failed` for an unsupported model while still exiting with code 0. Hive Mind correctly changed `executeCodexCommand()` to fail runs when structured Codex errors are present.

The April 26 incident exposed the missing distinction: not all item-level `error` items are fatal. A broad rule was safe for `turn.failed` and top-level `error`, but too broad for this app-server backpressure item.

### Root Cause 3: Failure reporting trusted the wrapper result, not the final task outcome

Once `executeCodexCommand()` returned `success: false`, the outer solve flow posted a failed-solution comment and uploaded the full log. It did not reconcile that failure with the captured final message saying that PR #551 had been updated, verified, and marked ready.

The direct fix belongs in `executeCodexCommand()` so the outer flow receives the right success status.

## Solution Implemented

The code fix is deliberately narrow:

1. `getCodexErrorEventSummary()` now ignores item-level messages matching:

   ```js
   /^in-process app-server event stream lagged; dropped \d+ events?$/i;
   ```

2. It still treats these as fatal:
   - top-level `type="error"` events;
   - `turn.failed` events;
   - any other `item.type="error"` message.

3. The summary now exposes:
   - `counts`: fatal error counts;
   - `ignoredCounts`: ignored non-fatal item warning counts;
   - `observedCounts`: raw parser counts for diagnostics.

4. `executeCodexCommand()` logs ignored non-fatal Codex item errors in verbose mode, preserving debug visibility without failing a successful run.

5. Regression coverage was added to `tests/test-codex-support.mjs`:
   - parser-level summary test for two stream-lag item errors;
   - execution-level test that reproduces the incident sequence and asserts `success: true`;
   - existing issue #1660 tests still assert unsupported-model structured errors fail.

## Solution Plans Considered

| Option                                                                          | Decision                      | Reason                                                                                                                                                                                               |
| ------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ignore all Codex `item.type="error"` events.                                    | Rejected.                     | Too broad; future item errors may be real tool failures.                                                                                                                                             |
| Treat any successful `turn.completed` as overriding all prior errors.           | Rejected.                     | A failed sub-step or partial failure might still need to fail automation even if a later turn completes.                                                                                             |
| Ignore only the exact app-server stream-lag item message.                       | Implemented.                  | Matches the observed false failure and keeps prior structured-error protection intact.                                                                                                               |
| Wait for upstream Codex behavior change only.                                   | Rejected.                     | The downstream wrapper needs to stop false-failing immediately; upstream issue #19689 tracks the cleaner long-term behavior.                                                                         |
| Require final assistant text plus `turn.completed` before ignoring the warning. | Not implemented in first fix. | The exact stream-lag message already identifies app-server backpressure. Adding final-text gating would make chunk ordering and resume behavior more brittle without preventing known real failures. |

## Existing Components Considered

| Component                                           | Role                                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `parseCodexExecJsonOutput()`                        | Already captured item errors, turn failures, stream errors, final messages, and usage data. No parser rewrite was needed. |
| `getCodexErrorEventSummary()`                       | Correct place to distinguish fatal and non-fatal structured Codex error-shaped events.                                    |
| `executeCodexCommand()`                             | Correct place to decide the tool result before the outer solve flow posts success or failure comments.                    |
| `detectUsageLimit()` and `classifyRetryableError()` | Kept unchanged; fatal error messages still flow through usage-limit and retry classification.                             |
| OpenAI Codex app-server warning semantics           | Online reference supporting the distinction between non-fatal warning-style events and terminal `turn.failed` errors.     |

## External Research

OpenAI's Codex CLI documentation and Codex automation cookbook confirm Codex is a supported automation surface for terminal and CI workflows. The app-server README documents JSONL transport, tracing with `RUST_LOG`, non-fatal warning notifications, item lifecycle events, and fatal `error`/`turn.failed` semantics.

The online search also found no existing OpenAI Codex issue with the exact phrase `in-process app-server event stream lagged`. An upstream issue was filed: https://github.com/openai/codex/issues/19689.

Sources and notes are saved in `research-sources.json`.

## Verification

Focused regression before the fix:

```bash
node tests/test-codex-support.mjs > docs/case-studies/issue-1696/logs/test-codex-support-before-fix.log 2>&1
```

Result before the fix: 35 passed, 2 failed. The two failures were the new issue #1696 tests.

Focused regression after the fix:

```bash
node tests/test-codex-support.mjs > docs/case-studies/issue-1696/logs/test-codex-support-after-fix.log 2>&1
```

Result after the fix: 37 passed, 0 failed.

Additional local checks:

```bash
bash scripts/check-mjs-syntax.sh
bash scripts/check-file-line-limits.sh
node tests/docs-validation.mjs
node scripts/validate-changeset.mjs
npm run format:check
npm run lint
npm run check:duplication
npm test
```

All completed successfully. Full outputs are saved as gzip-compressed files in `logs/`.

## Residual Risks

- The local workaround depends on an exact message. If Codex changes the wording of this non-fatal warning, Hive Mind may false-fail again until the pattern is updated.
- If Codex later uses `item.type="error"` for another non-fatal condition, this fix intentionally does not ignore it. That is safer than hiding real failures.
- The best long-term fix is upstream: emit app-server backpressure as a warning, or include explicit fatality/severity metadata in `codex exec --json`.
