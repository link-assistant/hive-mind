# Issue 1752 Case Study: Pre-PR Failure Reporting

## Summary

Issue #1752 reports a confusing pre-PR failure: no pull request was created, no failure comment appeared on the original issue, the terminal output included `Failure log attached to Issue`, and the push failure said the branch diverged even though the run appeared to be creating the branch at that moment.

The confirmed code root causes are local to hive-mind. The solver had no exact `--disable-issue-auto-creation-on-error` option, failures early in the issue flow did not record the original issue number until after several checks had already run, the terminal message used the generic `Issue` target label, and auto-continue could reuse an existing issue branch with no PR while the user-facing output still looked like fresh branch creation.

## Collected Data

- `data/issue-1752.json`: issue title, body, timestamps, labels, author, and comments field.
- `data/issue-1752-comments.json`: issue discussion. It was empty when collected.
- `data/issue-1752-events.json`: issue timeline events. It contained issue-type and label events only when collected.
- `data/pr-1753.json`: prepared PR metadata. At collection time it was a draft with one bootstrap commit, branch `issue-1752-824b615d875a`, and merge state `CLEAN`.
- `data/pr-1753-comments.json`, `data/pr-1753-review-comments.json`, `data/pr-1753-reviews.json`: PR discussion and review payloads. They were empty when collected.
- `data/branch-issue-1752-824b615d875a.json`: GitHub ref metadata for the prepared branch at collection time.
- `data/related-code-search.txt`: local code search for the relevant error-reporting, pre-PR notification, and push-rejection paths.
- `data/github-code-search-push-rejected.txt`: GitHub code search results for related `Push rejected` code.
- `external/github-non-fast-forward.html`, `external/github-pushing-commits.html`, `external/git-push.html`: downloaded official GitHub/Git documentation used for the non-fast-forward analysis.

No screenshots or log URLs were present in the issue body or comments at collection time.

## Timeline

- 2026-05-04 16:20:52 UTC: Issue #1752 opened.
- 2026-05-04 16:20:53 UTC: GitHub issue type was added.
- 2026-05-04 16:20:54 UTC: `bug` label was added.
- 2026-05-04 16:21:37 UTC: prepared branch bootstrap commit `36437c9` was created.
- 2026-05-04 16:21:45 UTC: draft PR #1753 was opened for branch `issue-1752-824b615d875a`.
- 2026-05-04 16:30 UTC: issue, PR, branch, and local code-search evidence was collected into this case-study folder.

## Requirements

- Add `--disable-issue-auto-creation-on-error`.
- Make the new flag usable from `hive-telegram-bot` overrides.
- Ensure failures before PR creation still post to the original issue when an issue URL is known.
- Remove the confusing terminal message `Failure log attached to Issue`.
- Explain how `Push rejected - branch has diverged, manual resolution required` can happen when the run appears to be creating a branch.
- Download related issue/PR/log/code data under `docs/case-studies/issue-1752`.
- Research external facts and known components for the branch-divergence behavior.
- Add debug output if the available data cannot prove the exact original run root cause.

## Root Causes

- The requested flag name did not exist. The older `--disable-report-issue` flag disabled separate error-report issue creation, but operators needed the explicit `--disable-issue-auto-creation-on-error` name for solve and telegram override configuration.
- The error reporter could still enter the interactive creation path in TTY sessions unless error issue creation was explicitly disabled. Non-interactive sessions skipped the prompt, but the requested safety switch did not exist.
- `solve.mjs` set `global.issueNumber` only after permission checks, entity validation, repository visibility detection, and auto-continue mode selection. A failure after URL validation but before that assignment had `owner` and `repo`, but no stored original issue number, so the pre-exit issue notifier could not target the issue.
- The fallback log upload path used `Issue` as a generic target label. That made terminal output read as if a log were attached to an abstract object instead of posted to the original issue comment thread.
- The branch-divergence message is possible because auto-continue can select an existing `issue-{number}-{hash}` branch with no PR. That branch was created by an earlier run, not the current run. If the local checkout is behind the remote branch, or if both sides have unique commits, a normal `git push` is rejected as non-fast-forward.

## External Research

- GitHub Docs explains that when another update reaches the same branch first, Git refuses the push to avoid losing commits, and the fix is to fetch and merge before pushing: https://docs.github.com/en/get-started/using-git/dealing-with-non-fast-forward-errors
- GitHub Docs for pushing commits says a local branch that is behind the upstream branch will receive `non-fast-forward updates were rejected`, and upstream changes must be fetched before pushing: https://docs.github.com/en/get-started/using-git/pushing-commits-to-a-remote-repository
- Git `push` documentation defines rejected refs and explains that non-fast-forward updates are blocked by default because they can lose history; it recommends first integrating the remote history and then pushing the combined result: https://git-scm.com/docs/git-push

## Implemented Solution

- Added `--disable-issue-auto-creation-on-error` to `SOLVE_OPTION_DEFINITIONS`.
- Normalized the new option to `disableReportIssue`, preserving the existing single behavior path.
- Relied on `hive.config.lib.mjs` solve-option passthrough so the new flag is accepted by `hive` and `hive-telegram-bot` overrides.
- Recorded `global.issueNumber` immediately after validating an issue URL, before permission and entity checks.
- Kept original issue failure comments/log uploads independent from separate error-report issue creation. The new flag disables creation of a new error-report issue only.
- Changed terminal wording from attaching to `Issue` to posting to `original issue #...`.
- Added existing-branch sync diagnostics before auto-PR bootstrap commits:
  - fetch `origin/<branch>`;
  - log ahead/behind counts;
  - fast-forward only when local is behind and has no unique commits;
  - abort with a clear manual-resolution message when local and remote already diverged.
- Added push-rejection diagnostics that explicitly state when the current run reused an existing issue branch and was not creating a fresh branch.

## Reproduction And Verification

Before the fix, the new focused tests failed because the new CLI flag was unknown and the branch-divergence explanation helper did not exist.

After the fix:

- `node tests/test-auto-report-issue.mjs` verifies the new flag is defined, parses successfully, and disables error issue creation even when `--auto-report-issue` is also present.
- `node tests/test-pr-creation-existing-branch.mjs` verifies existing non-fast-forward behavior remains non-destructive and the new explanation states that an orphan issue branch was reused rather than freshly created.
- `tests/test-hive-solve-option-parity.mjs` verifies the solve option remains available as hive/telegram passthrough through the shared solve option map.
- `tests/test-docs-options-sync.mjs` verifies the English configuration docs include the new solve option.

## Upstream Reporting

No upstream Git or GitHub issue was filed. The non-fast-forward push behavior is documented and expected; the defect was hive-mind's pre-PR reporting, missing operator flag, and unclear branch-reuse diagnostics.
