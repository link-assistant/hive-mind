# Case Study: Issue #1610 - No changes committed by Codex tool

## Summary

Issue [#1610](https://github.com/link-assistant/hive-mind/issues/1610) reports that a solve run using Codex appeared to create a pull request successfully, but the resulting PR in the target repository contained no effective code changes.

The investigation shows that Codex did not modify the repository at all. The solver still:

- created the bootstrap `.gitkeep` commit used for PR creation,
- opened PR [link-assistant/web-capture#69](https://github.com/link-assistant/web-capture/pull/69),
- accepted the session as successful even though Codex replied `I’m sorry, but I can’t help with that.`,
- reverted the bootstrap `.gitkeep` commit during cleanup,
- and finally posted "Ready to merge" on a PR whose net diff was empty.

So the real bug is not "git failed to commit". A commit was created and pushed. The real bug is that the solver treated a no-op / refusal Codex run as success, then removed the only bootstrap diff and finalized the PR as if work had been completed.

## Requirements from the issue

From the issue description and linked artifacts, the solver should:

1. Download and preserve all relevant logs and metadata inside `docs/case-studies/issue-1610`.
2. Reconstruct the timeline of what happened in the failed external solve run.
3. Identify each problem and its root cause.
4. Propose concrete solution plans.
5. Add more debug output where evidence is still incomplete.
6. Report issues in related repositories when appropriate.

## Timeline

All timestamps below are UTC.

| Time                  | Event                                                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-15T16:31:23Z  | `solve` started for `link-assistant/web-capture#68` with `--tool codex --attach-logs --verbose --no-tool-check --auto-accept-invite --tokens-budget-stats`.          |
| 2026-04-15T16:31:35Z  | Solver created branch `issue-68-f537a341d162`, appended a timestamp to existing `.gitkeep`, committed `0daae18` (`Initial commit with task details`), and pushed it. |
| 2026-04-15T16:31:41Z  | Draft PR [web-capture#69](https://github.com/link-assistant/web-capture/pull/69) was created from that branch.                                                       |
| 2026-04-15T16:31:54Z  | Codex session started.                                                                                                                                               |
| 2026-04-15T16:31:58Z  | Codex ended with the final message `I’m sorry, but I can’t help with that.`                                                                                          |
| 2026-04-15T16:31:58Z  | Solver checked the worktree and logged `✅ No uncommitted changes found`.                                                                                            |
| 2026-04-15T16:32:03Z  | Solver updated the PR title/body and marked the PR ready for review despite no repository changes from Codex.                                                        |
| 2026-04-15T16:32:04Z+ | Solver uploaded the session log to the PR.                                                                                                                           |
| 2026-04-15T16:34:35Z  | A second commit, `5b5a0ab`, reverted the bootstrap commit.                                                                                                           |
| later                 | The branch head still contained two commits, but their combined file diff was empty, so the PR showed `0 additions, 0 deletions`.                                    |
| later                 | The PR received a `Ready to merge` comment even though no actual issue fix existed.                                                                                  |

## Evidence

### 1. The initial bootstrap commit was real

The solve log records:

- branch creation,
- `.gitkeep` staging,
- commit `0daae18`,
- successful push,
- compare API reporting the branch as 1 commit ahead.

The live GitHub API for PR 69 confirms that commit:

- `docs/case-studies/issue-1610/web-capture-pr-69-commits.json`
- commit `0daae182b71d544de2e1d2a91dc6a544c20c660e`

### 2. Codex made no repository changes

The solve log records the final Codex message:

- `I’m sorry, but I can’t help with that.`

Immediately after that, the solver logged:

- `🔍 Checking for uncommitted changes...`
- `✅ No uncommitted changes found`

That means there was no code edit for the solver to commit after the model run.

### 3. Cleanup removed the only diff

The branch now contains a second commit:

- `5b5a0ab1791105532a94ede3d17a569a7aad40c2`
- message: `Revert "Initial commit with task details"`

GitHub compare data shows:

- `ahead_by: 2`
- `files: []`

So the branch still has history, but no net content difference relative to `main`.

### 4. The final PR is empty

Artifacts collected from GitHub:

- `docs/case-studies/issue-1610/web-capture-pr-69.diff` has `0` lines
- PR metadata reports `0 additions, 0 deletions`
- the PR still has a solution-log comment and a `Ready to merge` comment

## Root causes

### Root cause 1: No-op or refusal model output is not treated as a failed solve

Codex returned a refusal-like message and did not touch the repository, but the solver still proceeded through the normal success path.

Why this matters:

- no code changed,
- no fix was produced,
- but downstream steps assumed the work session had succeeded.

This is the primary product bug.

### Root cause 2: Cleanup always reverts the bootstrap `.gitkeep` / `CLAUDE.md` commit, even when it is the only change in the branch

`cleanupClaudeFile()` in [src/solve.results.lib.mjs](/tmp/gh-issue-solver-1776271017660/src/solve.results.lib.mjs:273) intentionally reverts the bootstrap commit after the session.

That is correct when the branch also contains real implementation commits. It is incorrect when no subsequent code changes exist, because reverting the bootstrap commit collapses the PR to an empty diff while leaving the PR open.

### Root cause 3: PR finalization logic is driven by branch cleanliness and PR metadata, not by proof of a real fix commit

The run continued after:

- no uncommitted changes,
- updated PR title/body,
- ready-for-review conversion,
- log attachment,
- mergeability / ready-state signaling.

The system lacks a guard like:

- "Did the tool create any non-bootstrap commit?"
- "Does the PR still have any non-bootstrap diff?"
- "Did the model produce a refusal / no-op outcome?"

### Root cause 4: Existing ordering fixes solved a different problem, but created space for this false-success outcome

Related fixes already in the codebase changed cleanup behavior:

- PR #1517 for issue #1516 moved cleanup after completion signaling to avoid premature finish signaling.
- PR #1578 for issue #1572 synchronized the branch before cleanup to prevent push failures.
- PR #1529 for issue #1528 clarified that `.gitkeep` should not count as meaningful code change for CI purposes.

Those changes improved reliability, but they did not add an outcome-level invariant that the solve must produce a real post-bootstrap change before the PR can be treated as successful.

## Why the PR looked successful even though it was empty

The misleading success state came from a combination of behaviors:

1. Auto-PR bootstrap intentionally creates a temporary `.gitkeep` commit so a PR can exist before the AI edits code.
2. Codex returned no useful work product.
3. The solver interpreted "no uncommitted changes" as stable/finished rather than "model produced nothing".
4. Cleanup reverted the bootstrap commit.
5. Ready-state logic did not verify that any real diff remained.

This made the PR operationally "clean" while semantically empty.

## Solution plan

### Fix 1: Detect no-op / refusal model outcomes and fail the run

Add a post-tool guard that marks the session unsuccessful when all of the following are true:

- the model exited normally,
- no files changed after the tool run,
- no non-bootstrap commit was created,
- and the final assistant message matches refusal / no-op patterns or is otherwise too weak to count as a solution.

Expected behavior:

- keep the PR in draft or comment with failure details,
- do not post `Ready to merge`,
- do not present the run as completed successfully.

### Fix 2: Do not revert the bootstrap commit when it is the only branch diff

Before `cleanupClaudeFile()` pushes a revert, check whether the branch contains any meaningful change beyond the bootstrap commit.

If not:

- leave the bootstrap commit in place for debugging, or
- close / label the PR as no-solution, or
- skip PR creation entirely when the tool run produced nothing.

At minimum, never convert a branch with one temporary commit into an empty PR and then mark it successful.

### Fix 3: Gate ready-state signaling on meaningful diffs

Before:

- removing `[WIP]`,
- marking ready for review,
- posting `Ready to merge`,

verify at least one of:

- PR diff contains non-bootstrap file changes,
- branch contains a non-bootstrap commit,
- PR body was updated with substantive implementation details,
- tests or checks demonstrate a real fix.

If not, stop with an explicit error such as:

- `No effective code changes were produced by the tool run`.

### Fix 4: Add targeted debug output

If the guard blocks success, log:

- final assistant message classification (`solution`, `refusal`, `empty`, `unclear`),
- branch commit list before cleanup,
- compare summary before cleanup and after cleanup,
- whether remaining diffs are bootstrap-only,
- whether PR state transitions were skipped due to no-op output.

This will make the next similar failure immediately diagnosable from the log alone.

### Fix 5: Add regression tests

Recommended automated tests:

1. Codex returns a refusal/no-op message and no file changes.
   Expected: run is marked failed/incomplete; no ready-for-review; no ready-to-merge comment.

2. Only bootstrap `.gitkeep` commit exists.
   Expected: cleanup does not convert the PR into an empty "successful" PR.

3. Branch has bootstrap commit plus real code commit.
   Expected: cleanup removes only bootstrap residue and leaves the real diff intact.

4. Empty-diff PR after cleanup.
   Expected: finalization path rejects it explicitly.

## Related external issue

This failure occurred while solving work in another repository:

- [link-assistant/web-capture#69](https://github.com/link-assistant/web-capture/pull/69)

The product bug belongs in `hive-mind`, because the incorrect behavior is in the solver’s orchestration and cleanup logic, not in `web-capture` itself. A separate upstream issue in `web-capture` is not necessary based on the evidence collected here.

## Collected artifacts

- `issue-1610.json`
- `pr-1611.json`
- `solution-draft-log-pr-1776270725953.txt`
- `web-capture-pr-69.txt`
- `web-capture-pr-69.diff`
- `web-capture-pr-69-commits.json`
- `web-capture-compare-main-issue-68.json`
- `web-capture-revert-commit.json`
- `web-capture-branch-gitkeep.json`

## Conclusion

The investigation disproves the literal reading of the issue title. Codex did commit something indirectly through solver bootstrap, but it did not implement a fix. The solver then cleaned up the bootstrap change and still treated the PR as successful.

The actionable bug is:

- no-op / refusal tool runs are not distinguished from successful runs,
- bootstrap cleanup can erase the only diff in the PR,
- and finalization logic does not require a meaningful remaining change before marking the PR ready.
