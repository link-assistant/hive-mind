# Issue 1665 Case Study: CI/CD Change Detection

## Summary

Issue 1665 reported that PR tests reran after commit `c3aac73b22f328b2597e94aa31c6f3561a6006b2`, even though that commit only changed `.gitkeep`. The run log confirms the detector compared the full PR range `37edf6e...c3aac73b` and therefore reclassified earlier code changes as current changes.

The fix is to make the workflow run a cheap detection job for every PR update, then let job-level conditions skip expensive work. For `pull_request.synchronize`, the detector now inspects the latest PR head update instead of the full PR diff.

## Artifacts

- Issue data: `issue-1665.json`, `issue-1665-comments.json`, `issue-1665-events.json`
- Related PR data: `pr-1663.json`, `pr-1668.json`
- Workflow log: `logs/pr-1663-run-24880457174.log`
- Screenshot: `assets/issue-screenshot.png`
- Template file inventories: `template-research/js-template-ci-files.txt`, `template-research/rust-template-ci-files.txt`
- Research source list: `research-sources.json`

## Timeline

- 2026-04-24 08:39 UTC: PR 1663 pushed commit `c3aac73b`, which reverted the initial task-details commit and touched only `.gitkeep`.
- 2026-04-24 08:39 UTC: workflow run `24880457174` started for `pull_request`.
- In the detect job log, lines 197-243 show the detector compared the full PR diff and emitted `mjs=true`, `package=true`, `docs=true`, and `code=true`.
- The full PR diff included earlier files such as `src/telegram-bot.mjs`, `src/telegram-solve-command.lib.mjs`, and `tests/test-telegram-options-before-url.mjs`, so downstream jobs ran even though the latest pushed commit was metadata-only.

## Requirements

- Avoid rerunning expensive test jobs when the latest PR update changes only non-code files such as `.gitkeep`.
- Still produce completed checks for non-code-only PR updates so required checks do not remain missing or pending.
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
- Extended `tests/test-detect-code-changes-1528.mjs` with an issue 1665 regression test that creates a local synthetic merge commit and verifies a latest `.gitkeep` change yields `mjs=false` and `code=false`.

## Verification

- Before the fix, the new regression test failed because `src/feature.mjs` appeared in the detected changed files for a metadata-only latest PR head commit.
- After the fix, `node tests/test-detect-code-changes-1528.mjs` passes.

## References

- GitHub Actions workflow syntax documents that pull request path filters use a three-dot PR diff.
- GitHub's required-check troubleshooting docs state that workflow-level path filtering can leave associated checks pending, while job-level conditional skips report success.
