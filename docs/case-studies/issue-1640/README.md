# Issue 1640 Case Study: Pre-PR Failure Notifications

## Summary

Issue #1640 reported a silent failure in the Telegram `/solve` workflow: the solver stopped before creating a pull request, so the user saw no PR and no GitHub-visible explanation on the source issue.

The attached run log shows a confirmed pre-PR failure. The solver correctly detected fork divergence and printed actionable terminal guidance, but exited through a direct `safeExit(1, ...)` path before the existing failure handler could upload logs or comment on the issue.

## Preserved Data

- `solve-2026-04-18T13-53-23-971Z.log`: full referenced gist log.
- `issue.json`: issue #1640 metadata and body.
- `pr-1641.json`: prepared PR metadata at investigation time.
- `related-prs-failure-logs.json`: related merged PRs for failure-log and issue-comment behavior.
- `related-prs-fork-divergence.json`: related merged PRs for fork-divergence behavior.

## Timeline

- 2026-04-18 13:53:23 UTC: `solve` starts for `xierongchuan/TaskMateServer#34` with `--tool codex --attach-logs --verbose --auto-accept-invite --auto-attach-solution-summary`.
- 2026-04-18 13:53:31 UTC: auto-fork determines the current user has pull access but no write access, enabling fork mode.
- 2026-04-18 13:53:33 UTC: no linked PR exists for the target issue, so a new PR flow starts.
- 2026-04-18 13:53:37 UTC: the fork is cloned and reset to `upstream/main`.
- 2026-04-18 13:53:38 UTC: pushing `main` to the fork fails with a non-fast-forward rejection.
- 2026-04-18 13:53:38 UTC: the solver reports fork divergence and exits with `Repository setup halted - fork divergence requires user decision`.
- No pull request existed at exit time, and the source issue did not receive a failure comment.

## Requirements Extracted

- Preserve all issue-related logs and data under `docs/case-studies/issue-1640`.
- Reconstruct the sequence of events and identify the root cause.
- Notify users on the GitHub issue when a confirmed issue run fails before PR creation.
- Include logs in that notification when `--attach-logs` is enabled.
- Avoid duplicate tool-generated comments when another early path already posts a specific issue comment.
- Keep the diagnostic output visible in terminal logs.
- Add debug or reusable instrumentation if the root cause cannot be determined. In this case the root cause was determinable from the preserved log and code path.

## Root Cause

The fork-divergence branch in `src/solve.repository.lib.mjs` calls:

```text
safeExit(1, 'Repository setup halted - fork divergence requires user decision')
```

`safeExit()` logs the exit reason and terminates the process. It does not throw, so the main `try/catch` in `solve.mjs` never reaches `handleMainExecutionError()`.

Before this issue, failure comments and failure log uploads were mostly centralized in `handleFailure()` and later execution-failure paths. Those paths already knew how to fall back from PR comments to issue comments when `global.issueNumber` was set, but direct `safeExit(1, ...)` calls bypassed them.

## Related Work

- PR #1463 added issue fallback log upload when PR creation failed, but it covered thrown/caught failures rather than direct `safeExit()` paths.
- PR #973 improved the fork-divergence terminal message, which is the exact message seen in this log.
- PR #1632 fixed tool-generated comment posting via `postTrackedComment()`, so the current solution reuses that helper rather than adding another comment path.

## External References

- GitHub REST issue comments documentation: `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` is the shared issue-comment endpoint used for issues and PR conversation comments. This supports using the existing `postTrackedComment()` helper for source-issue notifications.
- Git push documentation: non-fast-forward push rejections are expected safety behavior; `--force-with-lease` is the safer force-push option when history replacement is intentional. This matches the existing solver guidance and explains why the process must stop for user decision by default.

References:

- https://docs.github.com/en/rest/issues/comments
- https://git-scm.com/docs/git-push/2.53.0

## Solution Plan

1. Add a pre-exit hook to `safeExit()` so nonzero direct exits can run small cleanup/notification logic before process termination.
2. In `solve.mjs`, register a hook that only notifies when owner, repo, and issue number are known and no PR has been created.
3. Reuse `attachLogToGitHub()` for `--attach-logs` so the user gets the complete failure log on the issue.
4. Fall back to a concise tracked issue comment when logs are not attached or log upload fails.
5. Reuse tracked-comment state to avoid duplicate generic comments when an earlier specific pre-PR comment was already posted.
6. Add a focused regression test for the notifier behavior.

## Verification

The new regression test covers:

- nonzero exit + known issue + no PR is eligible for notification;
- zero exit, missing issue data, and existing PR are skipped;
- `--attach-logs` uploads failure logs to the issue;
- no-log or failed-log paths post a concise issue comment.
