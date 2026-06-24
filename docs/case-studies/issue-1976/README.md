# Issue 1976 Case Study: unclear auto-recovery safety stop

## Summary

Issue #1976 reported that the failure reason `Auto-recovery skipped - repository may contain commits that would be lost` was too mysterious when Hive Mind stopped before creating a pull request and posted a failure comment.

The incident came from a solve run for `olproff/fastsbc_acli#4` on 2026-06-23. Hive Mind needed a fork named `konard/olproff-fastsbc_acli`, found an existing repository with that name, discovered it was not a GitHub fork, tried to prove it was safe to replace, and received a GitHub compare 404. The terminal log had enough clues, but the issue comment only showed the terse stop reason plus generic fork guidance.

## Evidence

- Source issue data: `data/issue-1976.json`
- Source issue comments: `data/issue-1976-comments.json`
- Linked solve run log: `data/source-solve-run.log`
- Downstream issue/comment fetch attempts:
  - `data/downstream-issue-fetch-error.txt`
  - `data/downstream-comment-fetch-error.txt`
  - `data/downstream-failure-comment-4783781068.json`

The downstream repository is currently public, but `gh issue view 4 --repo olproff/fastsbc_acli` and the issue-comment API both returned 404 from this environment. The original failure comment body is still present inside `data/source-solve-run.log`.

## Timeline

1. 2026-06-23 21:49:19 UTC: `solve https://github.com/olproff/fastsbc_acli/issues/4 --model opus --think max --tool claude --attach-logs --verbose --no-tool-check --disable-report-issue --language en` started in Docker.
2. 2026-06-23 21:49:30 UTC: Hive Mind detected no write access to `olproff/fastsbc_acli` and enabled fork mode.
3. 2026-06-23 21:49:36 UTC: Hive Mind found `konard/olproff-fastsbc_acli`.
4. 2026-06-23 21:49:36 UTC: `gh api repos/konard/olproff-fastsbc_acli --jq '{fork: .fork, parent: .parent.full_name, source: .source.full_name}'` returned `{"fork":false,"parent":null,"source":null}`.
5. 2026-06-23 21:49:37 UTC: The safety compare against `olproff/fastsbc_acli` returned 404 Not Found.
6. 2026-06-23 21:49:37 UTC: Hive Mind printed manual terminal options, then exited with `Auto-recovery skipped - repository may contain commits that would be lost`.
7. 2026-06-23 21:49:39 UTC: Hive Mind posted a failure comment whose reason was only that terse exit string.

## Requirements

- Preserve the data-loss safety guard. Hive Mind must not delete a non-fork or mismatched fork unless it can prove replacement is safe or an explicit dangerous override is provided.
- Explain what happened in every user-facing place, including terminal exit reason, inline issue comments, and attached-log failure comments.
- Tell the user concrete options: back up and delete, rename, archive, or repair the existing repository; ask the owner or administrator; or use `--allow-force-non-fork-repository-deletion` only after confirming deletion is acceptable.
- Include case-study data and analysis in `docs/case-studies/issue-1976`.
- Add a regression test before the fix.

## External facts

- GitHub's repository API exposes `parent` and `source` only when a repository is a fork. Source: https://docs.github.com/en/rest/repos/repos#get-a-repository
- GitHub's compare API supports comparing different repositories only when they are in the same repository network, including forks. It may return 404 when the compared refs are not available in that network. Source: https://docs.github.com/en/rest/commits/commits#compare-two-commits
- GitHub fork creation is asynchronous, so fork setup code must already tolerate delayed availability. Source: https://docs.github.com/en/rest/repos/forks#create-a-fork
- `gh repo delete owner/repo --yes` is the non-interactive deletion form, and deletion requires the `delete_repo` scope. Source: https://cli.github.com/manual/gh_repo_delete
- `gh auth refresh --scopes ...` expands stored `gh` credential scopes. Source: https://cli.github.com/manual/gh_auth_refresh

No external issue was filed because the observed compare 404 and fork metadata behavior match GitHub's documented API boundaries.

## Root cause

The repository setup path already knew the exact incident context:

- existing repository: `konard/olproff-fastsbc_acli`
- expected upstream: `olproff/fastsbc_acli`
- relationship: the existing repository was not a GitHub fork
- safety status: GitHub compare returned 404, so Hive Mind could not prove the repository had no unique commits

That context stayed mostly in terminal log lines. The value passed to `safeExit()` was a short generic sentence. The pre-exit failure notifier and log-upload comment builder used that short reason as the visible failure reason, so the posted comment lost the most important details.

## Solution

The fix adds a pure recovery-message helper that builds a structured blocked-replacement reason. The repository setup safety branch now passes that structured reason to `safeExit()`, including the exact repository, expected upstream, relationship mismatch, and compare result.

The pre-PR failure notifier recognizes this structured reason and renders a specific action section instead of the older generic fork/recovery guidance. The attached-log path receives the same expanded reason and action section through `notifyIssueAboutPrePullRequestFailure()`, so both fallback comments and uploaded-log comments explain the same root cause and options.

## Verification

- Red test: `node tests/test-issue-1976-auto-recovery-message.mjs` initially failed because `src/solve.repository-recovery-message.lib.mjs` did not exist.
- Focused passing tests:
  - `node tests/test-issue-1976-auto-recovery-message.mjs`
  - `node tests/test-pre-pr-failure-notifier-1640.mjs`
  - `node tests/test-fork-parent-validation.mjs`
- Broad checks:
  - `npm run lint`
  - `npm run format:check`
  - `npm test` (`All 287 selected test file(s) passed.`)

Test logs are stored in `test-logs/`.
