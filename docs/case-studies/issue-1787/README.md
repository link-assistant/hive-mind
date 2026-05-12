# Issue 1787 Case Study: Existing PR Failure Notification

## Summary

Issue #1787 reported a failed `solve` run against an already-existing pull request. The solver detected fork divergence while preparing the fork for PR #280 in `ProverCoderAI/docker-git`, printed the failure only in the terminal log, and exited before posting a GitHub-visible explanation on the existing PR.

The earlier issue #1640 fix covered failures before a new PR exists. This issue is the sibling path: `solve` already knows the pull request number, but the pre-exit notifier skipped notification because `global.createdPR.number` was set.

## Preserved Data

- `data/original-failure-log.txt`: full linked gist log.
- `data/issue-1787.json`: issue metadata and body.
- `data/issue-1787-comments.json`: issue comments at investigation time.
- `data/pr-1790.json`: prepared PR metadata.
- `data/pr-1790-conversation-comments.json`: PR conversation comments.
- `data/pr-1790-review-comments.json`: PR inline review comments.
- `data/pr-1790-reviews.json`: PR reviews.
- `data/pr-1790-initial.diff`: initial draft PR diff.
- `data/related-prs-fork-divergence.json`: related merged fork-divergence work.
- `data/related-prs-failure-comments.json`: related merged failure-comment work.
- `data/test-pre-pr-failure-notifier-1640.txt`: focused regression test output.
- `data/npm-run-lint.txt`: lint output.
- `data/npm-run-format-check.txt`: Prettier check output.
- `data/npm-test.txt`: full test-suite output.

## Timeline

- 2026-05-12 12:01:06 UTC: `solve https://github.com/ProverCoderAI/docker-git/pull/280 --model opus --tool claude --attach-logs --verbose --no-tool-check --disable-report-issue --language en` starts.
- 2026-05-12 12:01:14 UTC: solver version `1.69.7` starts logging to `/home/box/solve-2026-05-12T12-01-14-111Z.log`.
- The input URL is recognized as PR URL #280, so continue mode is activated.
- The PR is detected as a fork PR from `konard/ProverCoderAI-docker-git`, linked to issue #274.
- The fork is cloned, validated as a fork of `ProverCoderAI/docker-git`, and `upstream/main` is fetched.
- The solver resets local `main` to `upstream/main`.
- Pushing `main` back to the fork fails with a non-fast-forward rejection.
- The solver reports fork divergence and exits with `Repository setup halted - fork divergence requires user decision`.
- No PR comment is posted, even though PR #280 was known before the repository setup failure.

## Requirements Extracted

- Preserve all issue-related logs and GitHub data under `docs/case-studies/issue-1787`.
- Reconstruct the sequence of events and identify the root cause.
- Notify users on an already-existing pull request when a nonzero pre-exit failure occurs.
- Preserve the issue-notification behavior for failures that happen before any PR exists.
- For fork divergence, include `--allow-fork-divergence-resolution-using-force-push-with-lease` in issue and PR comments.
- Do not include a full `/solve` or `solve` command example in fork-divergence comments, because the option works in both entrypoints.
- Reuse existing comment and log-upload components where possible.
- Add regression coverage before the fix.

## Root Cause

The failure path calls `safeExit(1, 'Repository setup halted - fork divergence requires user decision')` inside `src/solve.repository.lib.mjs`. `safeExit()` runs the pre-exit notifier registered by `src/solve.mjs`.

The notifier in `src/solve.pre-pr-failure-notifier.lib.mjs` was intentionally scoped to pre-PR failures:

```text
if (globalState?.createdPR?.number) return false;
```

That guard was correct for issue #1640, where no PR existed yet, but it made existing-PR setup failures silent in GitHub. In the reproduced log, `global.createdPR.number` was already #280 before fork synchronization started, so the notifier skipped the only GitHub-visible failure path.

## Related Work

- PR #1641 added pre-PR issue notifications for direct `safeExit(1, ...)` paths.
- PR #1753 fixed more pre-PR failure reporting behavior.
- PR #973 improved terminal guidance for fork divergence.
- PR #459 added automatic fork-divergence resolution with `--force-with-lease`.
- The existing `postTrackedComment()` helper already posts to the GitHub issue comments endpoint, which is also how PR conversation comments are represented.

## Solution Options Considered

- Extend the pre-exit notifier with a target resolver. This keeps all direct `safeExit(1, ...)` failures on one path and reuses the existing issue-comment behavior when no PR exists. This is the selected approach.
- Post directly from repository setup when fork synchronization fails. This would fix the observed case, but it would leave other existing-PR pre-exit failures silent and duplicate GitHub comment logic inside repository setup.
- Rely only on `--attach-logs` failure-log upload. This is insufficient because log upload can be disabled or fail, and the failure guidance still needs option-only fork-divergence text in both issue and PR comments.

## External References

- GitHub REST issue comments documentation: `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` creates a conversation comment for both issues and pull requests, because pull requests are issue-backed discussion objects.
- Git push documentation: `--force-with-lease` guards a forced update by requiring the remote ref to still match the expected value, which is why Hive Mind exposes it as an explicit opt-in for fork divergence resolution.

References:

- https://docs.github.com/en/rest/issues/comments
- https://git-scm.com/docs/git-push

## Solution Plan

1. Add a target resolver that selects the existing PR when `global.createdPR.number` is known, otherwise preserves the source-issue target for pre-PR failures.
2. Add an existing-PR failure comment builder using the same `Solution Draft Failed` marker as failure-log comments.
3. Keep log upload support for both targets by reusing `attachLogToGitHub()` with `targetType: 'pr'` or `targetType: 'issue'`.
4. Add fork-divergence guidance that names only `--allow-fork-divergence-resolution-using-force-push-with-lease`.
5. Pass that same option-only fork-divergence guidance into failure-log comments when `--attach-logs` succeeds.
6. Mark explicit failure-log or usage-limit comments as satisfying the pre-exit notification, so the pre-exit hook does not add duplicate generic comments.
7. Extend the existing notifier regression test with the PR-target path and fork-divergence wording checks.

## Verification

The regression test covers:

- existing issue behavior still targets the issue when no PR exists;
- existing PR setup failures target the pull request;
- fork-divergence comments include the force-with-lease opt-in option;
- fork-divergence comments do not include full command examples;
- issue and PR fallback comments use the tracked `Solution Draft Failed` marker;
- log upload still targets the issue for pre-PR failures;
- log upload targets the existing PR when a PR is already known;
- log-upload failures fall back to a plain PR comment.
