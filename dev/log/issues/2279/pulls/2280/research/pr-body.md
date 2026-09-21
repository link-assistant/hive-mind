Closes #2279.

## What failed

The automated release fallback opened a protected-branch PR with
`GITHUB_TOKEN`. Its ordinary `pull_request` workflows stayed
`action_required`, so the required `Pipeline Status` check never appeared.
The #2274 workaround dispatched `release.yml` manually and that run passed on
the exact PR SHA, but GitHub does not evaluate `workflow_dispatch` job checks
as pull-request required checks. Runs 35530983182 and 35536619299 were therefore
green while release PRs #2277 and #2278 still had empty check rollups and could
not merge.

## What changed

- Open fallback release PRs through a dedicated independent token and wait for
  the checks associated with the PR via `gh pr checks --watch`.
- Remove the ineligible `validate-pr` dispatch mode and its `actions: write`
  permission.
- Fail before creating an orphan release branch when the independent token is
  absent.
- Retry only the short check-discovery/mergeability races; propagate permanent
  required-check, review, and base-policy failures immediately.
- Correct the prior #2274 regression and add pre-fix coverage for #2279 across
  both release modes.
- Refresh the yargs bootstrap declaration from 18.1.0 to 18.2.0 after the
  initial PR CI correctly reported it stale.
- Suppress the intentional legacy-entry-point deprecation only in the
  auto-fork compatibility test, while retaining the dedicated deprecation
  regression.
- Update all four CI/CD best-practice translations and the release changeset.

## Reproduction and verification

The production sequence and complete issue/PR/run/ruleset evidence are under
[`dev/log/issues/2279/pulls/2280`](https://github.com/link-assistant/hive-mind/tree/issue-2279-b1afd26393ba/dev/log/issues/2279/pulls/2280).
`tests/release-required-checks-2279.test.mjs` was committed first and failed on
the old implementation because it dispatched a workflow instead of waiting on
PR-associated checks.

Verified locally:

- complete default suite: 498/498 test files passed;
- live GitHub integration suite: 4/4 assertions passed;
- focused #2175, #2274, and #2279 release regressions;
- actionlint, dependency freshness, status gate, Changesets guards, syntax,
  line limits, ESLint, Prettier, duplication, secretlint, and compatibility
  checks.

This is not a UI change, so screenshots are not applicable.

## Required administrator action

Before the next protected-branch release, add a repository Actions secret named
`RELEASE_PULL_REQUEST_TOKEN` containing a dedicated, repository-scoped
fine-grained PAT with only the permissions needed to read Actions/check state,
create and merge pull requests, and update repository contents. A custom
GitHub App installation token is the preferred short-lived follow-up and can
be wired to the same step-local `GH_TOKEN` interface.

The matching defect in the upstream pipeline template is documented with a
minimal reproduction, workarounds, and corrected implementation plan in
[link-foundation/js-ai-driven-development-pipeline-template#192](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/192#issuecomment-5756981358).
