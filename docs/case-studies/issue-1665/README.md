# Issue 1665 Case Study: CI/CD Change Detection

## Summary

Issue 1665 reported that PR tests reran after commit `c3aac73b22f328b2597e94aa31c6f3561a6006b2`, even though that commit only changed `.gitkeep`. The run log confirms the detector compared the full PR range `37edf6e..c3aac73b` and therefore reclassified earlier code changes as current changes.

The fix is to make the workflow run a cheap detection job for every PR update, then let job-level conditions skip expensive work. For `pull_request.synchronize`, the detector now inspects the latest PR head update range instead of the full PR diff. A single metadata-only push skips expensive jobs; a multi-commit push that includes code still runs them.

## Artifacts

- Issue data: `issue-1665.json`, `issue-1665-comments.json`, `issue-1665-events.json`
- Related PR data: `pr-1663.json`, `pr-1668.json`
- Workflow log: `logs/pr-1663-run-24880457174.log`
- Follow-up workflow data: `pr-1668-run-24887339421.json`, `logs/pr-1668-run-24887339421-detect-changes.log`
- Screenshot: `assets/issue-screenshot.png`
- Template file inventories: `template-research/js-template-ci-files.txt`, `template-research/rust-template-ci-files.txt`
- Research source list: `research-sources.json`

## Timeline

- 2026-04-24 08:39 UTC: PR 1663 pushed commit `c3aac73b`, which reverted the initial task-details commit and touched only `.gitkeep`.
- 2026-04-24 08:39 UTC: workflow run `24880457174` started for `pull_request`.
- In the detect job log, lines 197-243 show the detector compared the full PR diff and emitted `mjs=true`, `package=true`, `docs=true`, and `code=true`.
- The full PR diff included earlier files such as `src/telegram-bot.mjs`, `src/telegram-solve-command.lib.mjs`, and `tests/test-telegram-options-before-url.mjs`, so downstream jobs ran even though the latest pushed commit was metadata-only.
- 2026-04-24 11:33 UTC: PR 1668 workflow run `24887339421` started after one synchronize event added the CI fix commit `05a3e42d` and the `.gitkeep` revert commit `ffe4486f`.
- In the PR 1668 detect job log, lines 1667-1730 show `GITHUB_BEFORE_SHA=88c4abfa`, `GITHUB_AFTER_SHA=ffe4486f`, changed workflow/script/test files, and `code=true`.
- That PR 1668 run is not a metadata-only reproduction: the latest push update contained code and workflow changes, so `test-suites` and related expensive jobs were expected to run.

## Requirements

- Avoid rerunning expensive test jobs when the latest PR update changes only non-code files such as `.gitkeep`.
- Still produce completed checks for non-code-only PR updates so required checks do not remain missing or pending.
- Run expensive jobs when a single synchronize event pushes multiple commits and any commit in that update changes code or workflow files.
- Preserve docs-only behavior: docs should run documentation/lint-oriented checks without requiring changesets or full test execution.
- Compare the local CI/CD implementation with the JS and Rust pipeline templates.
- Keep issue artifacts and analysis in `docs/case-studies/issue-1665/`.
- Add regression coverage before the fix.

## Root Causes

1. `scripts/detect-code-changes.mjs` compared `GITHUB_BASE_SHA..GITHUB_HEAD_SHA` for every PR event. On `pull_request.synchronize`, that is the full PR diff, not the files changed by the latest pushed commit.
2. `.github/workflows/release.yml` used `pull_request.paths`. GitHub documents that pull request path filtering is based on the PR changed-file set, and skipped required workflows can remain pending. That makes workflow-level path filtering the wrong layer for required CI checks.
3. The detector did not have a synthetic merge-commit regression test. Existing tests covered file classification but not the Git history shape used by GitHub Actions.

## Template Comparison

The JS template at `556c2d459255a5296a3dae51b252458ef980052f` and Rust template at `353d89396fd420339f2dab0e548ca2caf6198cd5` both avoid workflow-level `pull_request.paths` in the main release workflow. They run a detect-changes job first and gate expensive jobs with job-level `if:` conditions.

Both templates also detect GitHub Actions' synthetic pull request merge commit and compare the PR head's latest commit range (`HEAD^2^..HEAD^2`) for PR updates. That is the behavior adopted here, with an added full-PR fallback for non-synchronize PR events.

No matching template bug was found, so no upstream template issue was filed.

## Solution

- Removed workflow-level `pull_request.paths` from `.github/workflows/release.yml`.
- Changed the detect job checkout to `fetch-depth: 0`, so synthetic merge parents and PR head history are available.
- Passed PR action and before/after SHA context into `scripts/detect-code-changes.mjs`.
- Updated `scripts/detect-code-changes.mjs`:
  - `pull_request.synchronize` uses event `before..after` when available.
  - If event SHAs are unavailable locally, it falls back to synthetic merge commit detection and compares `HEAD^2^..HEAD^2`.
  - `opened` and `reopened` continue using the full PR diff.
  - `.js` now participates in positive code matching, matching the workflow's historical trigger intent.
- Tightened local commit validation so syntactically valid but missing SHAs do not silently collapse the detected changed-file set.
- Extended `tests/test-detect-code-changes-1528.mjs` with issue 1665 regression tests that verify:
  - an event SHA range containing only a latest `.gitkeep` update yields `mjs=false` and `code=false`;
  - an event SHA range containing code plus a final `.gitkeep` commit yields `mjs=true` and `code=true`;
  - the synthetic merge fallback still uses the latest PR head commit when event SHAs are unavailable.

## Verification

- Before the fix, the new regression test failed because `src/feature.mjs` appeared in the detected changed files for a metadata-only latest PR head commit.
- After the fix, `node tests/test-detect-code-changes-1528.mjs` passes.
- Reproducing PR 1668 run `24887339421` locally with `GITHUB_BEFORE_SHA=88c4abfa` and `GITHUB_AFTER_SHA=ffe4486f` correctly reports code changes because the push update included `.github/workflows/release.yml`, `scripts/detect-code-changes.mjs`, and `tests/test-detect-code-changes-1528.mjs`.
- Reproducing only the final PR 1668 `.gitkeep` commit locally with `GITHUB_BEFORE_SHA=05a3e42d` and `GITHUB_AFTER_SHA=ffe4486f` reports `mjs=false` and `code=false`.

## References

- GitHub Actions workflow syntax documents that pull request path filters use a three-dot PR diff.
- GitHub's required-check troubleshooting docs state that workflow-level path filtering can leave associated checks pending, while job-level conditional skips report success.
