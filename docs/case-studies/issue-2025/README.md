# Issue 2025 CI/CD Failure Case Study

Issue: https://github.com/link-assistant/hive-mind/issues/2025

Failing run: https://github.com/link-assistant/hive-mind/actions/runs/29020837748

Prepared PR: https://github.com/link-assistant/hive-mind/pull/2026

## Requirements

- Download and preserve the CI logs and related metadata for the failing run.
- Compare the repository CI/CD layout with the JavaScript, Rust, Python, and C# pipeline templates.
- Identify false positives, false negatives, warnings, and errors in the failing run.
- Find root causes before fixing code.
- Add a reproducing regression test for any bug fix.
- Document the timeline, root causes, solution options, and verification.
- Report issues to upstream templates only if the same issue is present there.

## Preserved Data

- Full failing CI log: `ci-logs/checks-and-release-29020837748.log`
- Failing run metadata: `metadata/run-29020837748-api.json`
- Failing run jobs: `metadata/run-29020837748-jobs.json`
- Branch run metadata: `metadata/recent-runs-issue-branch.json`
- Issue and PR discussion metadata: `metadata/issue-2025.json`, `metadata/pr-2026-*.json`
- CI/CD template file trees: `template-snapshots/*-tree.json`
- CI/CD template release workflows: `template-snapshots/workflows/*-release.yml`
- CI/CD path comparison: `template-snapshots/ci-cd-paths.md`
- Local check logs: `checks/*.log`, including the completed default-suite rerun in `checks/npm-test-rerun.log`

## Timeline

- 2026-07-09 13:17:51 UTC: `Checks and release` run `29020837748` started on `main` at SHA `982b42c5a25fabc6da697bd4253beddee0fd9e92`.
- 2026-07-09 13:20:51 UTC to 13:23:37 UTC: `lint`, `test-compilation`, `validate-docs`, and `check-file-line-limits` completed successfully.
- 2026-07-09 13:24:22 UTC: `test-suites` started.
- 2026-07-09 13:28:12 UTC: default test runner reached `[97/309] tests/test-isolation-runner.mjs`.
- 2026-07-09 13:28:14 UTC: `tests/test-isolation-runner.mjs` failed during module import with `TypeError: fetch failed`. The fetch aggregate included `ETIMEDOUT` for `104.18.0.22:443` and `104.18.1.22:443`, plus IPv6 `ENETUNREACH` for Cloudflare addresses.
- 2026-07-09 13:30:17 UTC: `test-suites` completed with conclusion `failure`. The workflow failed even though the earlier checks and the separate execution/memory jobs passed.
- 2026-07-09 15:03:55 UTC: the prepared issue branch placeholder run `29027959002` passed at SHA `b13f5921884983c980d03fde8f163825d84ee45b`; this run was before the fix and did not exercise the changed code.

## Root Causes

### 1. Import-time network dependency in a pure helper test

`src/isolation-runner.lib.mjs` exported pure helpers such as `generateSessionId`, but it also initialized `use-m` and loaded `command-stream` at module top level. `tests/test-isolation-runner.mjs` only needed pure helpers, but importing the module still executed the `use-m` bootstrap and attempted a CDN fetch before the assertions could run.

That made the default test suite fail for an external network timeout, not for an isolation-runner behavior regression. The CI result was a false negative.

The Node.js ES module documentation confirms that top-level `await` participates in module evaluation, so any import waits for that asynchronous work. See https://nodejs.org/api/esm.html#top-level-await.

### 2. Misleading workflow step labels

Four workflow steps were named `Use Node.js 20.x`, but their `actions/setup-node` configuration was already `node-version: 24.x`. This did not cause the failure, but it was a CI log false signal because the package requires Node `>=24.0.0`.

### 3. Existing warning noise

The saved run also contains:

- `check-file-line-limits` warnings for files already near the 1500-line hard limit.
- Git default-branch hints emitted by `actions/checkout` internals.
- Node `DEP0040` warnings from dependency code.
- jscpd clone reports in the successful `lint` job.

These were not the root cause of run `29020837748`. The line-limit warnings are an intentional guardrail from the repository's existing checker and should be handled by dedicated extraction work rather than weakened in this fix.

## Template Comparison

The template tree snapshots show that all four templates use release/check workflows plus language-specific CI scripts. The JavaScript template is the closest match: it uses Node 24 setup, dependency installation, and an `npm test` gate.

No template snapshot contains the local `isolation-runner.lib.mjs` import-time `use-m`/`command-stream` dependency. The failing false negative is local application code behavior, not a reusable pipeline-template defect. No upstream template issue was filed.

The local stale `Use Node.js 20.x` labels were also local drift. The JavaScript template release workflow uses generic `Setup Node.js` labels with `node-version: '24.x'`.

GitHub's dependency caching documentation describes caches as an optimization that jobs must still be able to recreate or download when missing. By inference, a unit test for pure helpers should not require a live external CDN fetch at import time. See https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching.

## Fix

- Move `command-stream` loading in `src/isolation-runner.lib.mjs` behind a lazy `getCommandStreamDollar()` helper.
- Call the lazy loader only from functions that actually execute shell commands.
- Reset the cached loader promise after a load failure so a later command can retry.
- Add a regression test that stubs `globalThis.fetch`, deletes `globalThis.use`, dynamically imports the isolation runner, and asserts the import made zero fetch calls.
- Rename the four stale workflow steps from `Use Node.js 20.x` to `Use Node.js 24.x`.

## Verification

Focused checks completed:

- A pre-fix smoke reproduction failed by importing `src/isolation-runner.lib.mjs` with `fetch` stubbed to throw.
- The same smoke check passed after lazy loading was introduced.
- `node tests/test-isolation-runner.mjs` passed with `16 passed, 0 failed`.
- `node --check src/isolation-runner.lib.mjs` passed.
- `node --check tests/test-isolation-runner.mjs` passed.
- `git diff --cached --check` passed.

Local environment note:

- This workspace has Node `v20.20.2`, while the package and CI require Node `>=24.0.0`.
- `node scripts/npm-install-with-retry.mjs install` completed with expected engine warnings in `checks/npm-install.log`.
- The first local `npm test` attempt reached `[297/309] tests/test-tool-specific-defaults.mjs` and was interrupted during long-running local shell-out tests. That partial log is preserved in `checks/npm-test.log`.
- A second local `npm test` rerun completed successfully on this host: `All 309 selected test file(s) passed.` The full rerun log is preserved in `checks/npm-test-rerun.log`.

The fresh PR run on GitHub Actions is the authoritative full-suite verification because it uses Node 24.x.
