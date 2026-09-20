# Issue 1766 Case Study

## Summary

Issue: https://github.com/link-assistant/hive-mind/issues/1766

The failed Telegram work session reported `Work session failed (exit code: -1)` after a detached `screen` run. The available logs show one confirmed hive-mind defect and one incomplete-failure signal:

- Confirmed defect: feedback detection ran `git log` from `/home/box` even though the prepared repository was `/tmp/gh-issue-solver-1778263915988`, producing two `fatal: not a git repository` messages before falling back to the GitHub API.
- Incomplete-failure signal: the session log ends while Codex is still streaming and before the detached wrapper writes its normal completion footer. `start-command` therefore reports `exitCode: -1` because no real exit code can be recovered from the log.

The code fix in this PR addresses the confirmed hive-mind defect by passing the prepared repository path into feedback detection and running local git commands with that working directory.

## Requirements From The Issue

- Save the issue body, attached logs, screenshot, and related repository/PR state under `docs/case-studies/issue-1766`.
- Reconstruct the failure timeline and identify the root cause where possible.
- Fix the confirmed root cause in hive-mind.
- Add a regression test that reproduces the issue-specific failure mode.
- Search for related public information and avoid external issue filing unless the evidence points to an external bug.

## Artifacts

- `raw/issue-1766.json`: original issue details.
- `raw/work-session-9b327ece-b02f-4c49-8555-390efe99a6a1.log`: raw attached work-session log.
- `raw/solve-2026-05-08T18-11-45-608Z.log`: local timestamped solve log for the same run.
- `raw/screenshot.png`: Telegram failure screenshot.
- `raw/start-command-status-9b327ece.json`: detached session status snapshot.
- `raw/external-issue-3.json`: target private issue metadata.
- `raw/external-pr-4.json`: target private PR metadata.
- `raw/external-issue-3-comments.json`: target private issue comments.
- `raw/external-pr-4-conversation-comments.json`: target private PR conversation comments.
- `raw/external-pr-4-review-comments.json`: target private PR inline comments.
- `raw/external-pr-4-reviews.json`: target private PR reviews.

## Timeline

- 2026-05-08 18:11:37 UTC: detached `screen` session starts from `/home/box` with command `solve https://github.com/PONYAWKA/diagnostic-and-monitoring-tests/issues/3 --think max --tool codex --attach-logs --verbose --no-tool-check --disable-report-issue --language en`.
- 2026-05-08 18:11:57 UTC: hive-mind creates and pushes branch `issue-3-178d07ed7937` in `/tmp/gh-issue-solver-1778263915988`.
- 2026-05-08 18:12:04-18:12:06 UTC: hive-mind creates draft PR `PONYAWKA/diagnostic-and-monitoring-tests#4` and links issue `#3`.
- 2026-05-08 18:12:06 UTC: feedback detection starts. It logs the correct PR and repo but runs `git log` without a repository `cwd`.
- 2026-05-08 18:12:06 UTC: `git log` emits `fatal: not a git repository (or any of the parent directories): .git` twice, then feedback detection falls back to the GitHub API for the last commit timestamp.
- 2026-05-08 18:12:16 UTC: hive-mind starts `codex exec` in `/tmp/gh-issue-solver-1778263915988`.
- 2026-05-08 18:12:57 UTC: the log shows `Cleaning up...` interleaved with active Codex websocket events. There is no normal `Codex command completed`, `Codex command failed`, or detached wrapper `Exit Code:` footer.
- Later status query: `start-command` reports `status: executed` and `exitCode: -1` for execution `9b327ece-b02f-4c49-8555-390efe99a6a1`.

## Findings

### Confirmed Hive-Mind Bug

`detectAndCountFeedback()` read the last branch commit with:

```js
await $`git log -1 --format="%aI" origin/${branchName}`;
```

That command inherited the process working directory. In this failed session the process was launched from `/home/box`, while the cloned target repository lived at `/tmp/gh-issue-solver-1778263915988`. The result was the two `fatal: not a git repository` lines in the attached log.

The fallback GitHub API avoided a total failure, but the local git command was still wrong and polluted the diagnostic log during the failure window.

### Exit Code -1 Mechanics

The log does not prove that Codex itself returned `-1`. Instead, the detached session log lacks the normal completion footer from the `screen` wrapper. The status formatter can only infer that the detached process is gone and no exit code was recorded, so it reports `-1`.

The local timestamped solve log shows cleanup beginning at 2026-05-08 18:12:57.084 UTC, followed by another Codex stream event at 18:12:57.090 UTC. That indicates the solve process began cleanup while Codex was still active. The available artifacts do not identify the interruption source.

## Solution

- `detectAndCountFeedback()` now accepts `repositoryPath`.
- `prepareFeedbackAndTimestamps()` passes `tempDir` as the repository path.
- The main solve flow and watch flow pass the prepared repo path into feedback detection.
- Local git timestamp probes now use `$({ cwd: repositoryPath })` when a repository path is available.

## Regression Test

`tests/test-issue-1766-feedback-git-cwd.mjs` mocks the failed session shape:

- the process starts outside the repository,
- the prepared repository path is available,
- `git log` only succeeds when executed with that `cwd`,
- the GitHub commit timestamp fallback must not run.

The test fails on the old behavior because `git log` runs without `cwd`, then passes with the fix.

## External Research

Public web searches for the session identifiers, the target repository/issue, and the `Work session failed (exit code: -1)` text did not find a relevant public upstream issue. The target repository is private, and the confirmed defect is in hive-mind's feedback-counting path, so no external issue was filed.
