# Issue 1698 Case Study: Stable Test Entrypoints

## Summary

Issue 1698 reported that adding tests by editing the `package.json` `test` script creates avoidable merge conflicts between pull requests. PR 553 is the concrete example: it changed `package.json` only to append another `node tests/...` command to the long chained test script.

The fix adds a stable test runner at `scripts/run-tests.mjs`, changes `npm test` to call that runner, and changes the CI `test-suites` job to call `npm test` instead of listing test files. New default-suite tests can now opt in by adding `@hive-mind-test-suite default` to the test file itself.

## Artifacts

- Issue data: `raw/issue-1698.json`, `raw/issue-1698-comments.json`
- Related PR data: `raw/pr-553.json`, `raw/pr-1699.json`
- Template inventories: `template-research/*.txt`
- Template source line references: `template-research/testing-source-lines.txt`
- Verification logs: `logs/npm-test.log`, `logs/github-integration.log`
- Research source list: `research-sources.json`

## Timeline

- 2025-10-14: PR 553 added task split tests and changed `package.json` to append a new test command.
- 2026-04-26 16:15 UTC: PR 553 was updated again, keeping the conflict-prone package script change visible as a current example.
- 2026-04-26: Issue 1698 requested migration toward more traditional test entrypoints and best practices from `test-anywhere` and the JS/Rust templates.
- This PR replaces the hard-coded package test chain with a runner and keeps CI coverage through stable runner suites.

## Requirements

- Stop adding individual test commands to `package.json`.
- Use best practices from `test-anywhere` and the JS/Rust CI/CD templates where applicable.
- Keep iteration focused on Ubuntu for this repository.
- Preserve existing curated local and CI test coverage.
- Store issue data, related PR data, logs, and template comparison artifacts under `docs/case-studies/issue-1698/`.
- Add a reproducing regression test before the implementation.
- Report template issues if the same defect exists upstream.

## Root Causes

1. `package.json` had a long `scripts.test` command chain. Any PR adding a default test had to edit the same line, so unrelated PRs conflicted.
2. `.github/workflows/release.yml` duplicated the same anti-pattern inside the `test-suites` job with many individual `node tests/...` steps.
3. There was no stable suite-discovery convention. Tests could be standalone, but the suite membership lived in central files instead of the test file being added.
4. Full native discovery with `node --test tests/` is too broad for this repository today. It discovers older and integration-oriented files outside the curated suite, so a direct switch to all-file discovery would change behavior.

## Template Comparison

The `test-anywhere` project documents a single test API that delegates to native Bun, Deno, and Node test frameworks. Its package scripts use stable native commands such as `node --test tests/`, `bun test`, and `deno test --allow-read`.

The JavaScript template uses `test-anywhere` as a dev dependency and keeps `npm test` as a stable native test command instead of a long list of files. Its CI matrix invokes `npm test`, `bun test`, and `deno test --allow-read`.

The Rust template does not share the JavaScript package-test problem; its CI/CD structure keeps checks behind reusable scripts and language-native commands. No matching upstream template issue was found, so no template issue was filed.

## Solution

- Added `scripts/run-tests.mjs`.
  - Runs selected test files sequentially with clear per-file progress.
  - Preserves the legacy curated default suite.
  - Discovers new suite members from `@hive-mind-test-suite <name>` markers.
  - Supports `--list`, `--suite`, `--all`, `--continue-on-failure`, and `--node-bin`.
- Changed `package.json` `scripts.test` to `node scripts/run-tests.mjs --suite default`.
- Added `test-anywhere` as a dev dependency and wrote the issue 1698 regression with it.
- Changed the CI `test-suites` job to run:
  - `npm test` for the default local suite.
  - `node scripts/run-tests.mjs --suite github-integration` for the existing real-GitHub feedback-lines integration test.
- Marked `tests/test-feedback-lines-integration.mjs` as `github-integration` so it remains in CI without making `npm test` require GitHub repository mutation.

## Regression Test

`tests/test-test-runner-1698.test.mjs` initially failed because:

- `package.json` `scripts.test` did not delegate to `scripts/run-tests.mjs`.
- the `test-suites` workflow job did not run `npm test`.
- both surfaces enumerated individual `node tests/...` commands.

After the fix, the regression passes and prevents reintroducing the conflict-prone entrypoints.

## Verification

- `node tests/test-test-runner-1698.test.mjs`
- `npm test`
- `node scripts/run-tests.mjs --suite github-integration`

The verification logs are preserved under `logs/`.

## Follow-Up Notes

The default suite still contains a legacy seed list so this change does not silently expand local test scope. Future tests should opt in by adding a suite marker to the new test file. Over time, legacy default-suite files can be marked in place and then removed from the seed list without touching `package.json` or CI.
