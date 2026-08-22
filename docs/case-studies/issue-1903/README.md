# Case Study: Issue #1903 — Check CI/CD for false positives and fix them

## Summary

CI run [27332260596](https://github.com/link-assistant/hive-mind/actions/runs/27332260596) on `main`
(sha `ea897f73`) failed. The only failing job was **`test-execution`**, and it failed in the very first
real step — **"Install dependencies"** (`npm install`) — with a transient network error:

```
npm error code ECONNRESET
npm error network aborted
npm error network This is a problem related to network connectivity.
npm error network In most cases you are behind a proxy or have bad network settings.
##[error]Process completed with exit code 1.
```

This is a **false positive**: the registry connection was dropped mid-download on the GitHub-hosted runner.
It has nothing to do with the commit under test. Because the `npm install` step had **no retry**, a single
dropped socket failed the whole job (and every dependent step was skipped).

Full step log: [`data/run-27332260596-test-execution-failed.txt`](data/run-27332260596-test-execution-failed.txt).

## Timeline / Sequence of Events

| Time (UTC)          | Event                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-11 07:52:35 | Merge to `main` (sha `ea897f73`, PR #1890) triggers run 27332260596 ("Checks and release").                                               |
| 2026-06-11 07:52:38 | `detect-changes` → success. `lint`, `validate-docs`, `test-compilation`, `check-file-line-limits` all → success.                          |
| 2026-06-11 07:54:06 | `test-execution` job starts on `ubuntu-24.04`, Node 20.x.                                                                                 |
| 2026-06-11 07:54:21 | "Install dependencies" step runs `npm install`.                                                                                           |
| 2026-06-11 07:54:28 | npm aborts with `ECONNRESET` / `network aborted` after ~7s. Step exits 1.                                                                 |
| 2026-06-11 07:54:28 | All later steps (`solve.mjs` execution, log verification, `hive.mjs`, etc.) are **skipped**; job → failure.                               |
| 2026-06-11 08:04:40 | `test-suites` job (separate job, same workflow) finishes its `npm install` + full suite **successfully** — the flake did not recur there. |
| 2026-06-11 08:04:45 | Workflow concludes **failure** solely because of the `test-execution` flake.                                                              |

The fact that the sibling `test-suites` job installed dependencies and ran the full test suite successfully in the
same workflow run confirms the failure is a transient infrastructure flake, not a code defect.

## Requirements (from the issue)

1. Check CI/CD for all false positives and errors, and fix them all.
2. Download all logs/data and compile a deep case study under `./docs/case-studies/issue-{id}`.
3. Reconstruct the timeline/sequence of events.
4. List each requirement from the issue.
5. Find the root cause of each problem.
6. Propose solutions and solution plans for each requirement, checking for existing components/libraries.
7. If there's not enough data for a root cause, add debug output / verbose mode for the next iteration.
8. If the issue is caused by another repo we can file against, open an issue there with a reproducer, workaround, and fix suggestion.
9. Apply the fix across the **entire** codebase (fix it in every place the bug exists).

## Root Cause

`npm install` (and `npm ci`) talk to the npm registry over the network. On GitHub-hosted runners the
connection is occasionally reset mid-transfer (`ECONNRESET` / `network aborted`). npm's default registry
retry budget (`fetch-retries=2`) was not enough to absorb this particular drop, and the workflow step
ran a **bare** `npm install` with **no process-level retry**, so the job failed immediately.

The bug existed in **every** install step of the workflow — 8 occurrences in `.github/workflows/release.yml`
(`npm install` ×7 and `npm ci` ×1) across the `lint`, `test-compilation`, `test-execution`, `test-suites`,
`memory-check`, and publish jobs. Any of them could (and eventually would) flake the same way; `test-execution`
just drew the short straw this time.

This is the registry-download sibling of issue #1724, where `use-m`'s per-test `npm install -g` flaked with
`ENOTEMPTY`. That fix already added a shared retry helper (`isRetryableNpmError`, `computeBackoffMs`) in
`scripts/preinstall-use-m-packages.mjs`, and its regex **already** classifies `ECONNRESET`/`ETIMEDOUT` as
retryable. What was missing is applying that same retry discipline to the top-level dependency-install steps.

## Why It's Hard to Reproduce

- It depends on the runner's network conditions at the instant npm streams a tarball; it is non-deterministic.
- Only one of several `npm install` steps in a run typically hits it, so re-running the job usually "fixes" it —
  which is exactly the trap of a false positive: people re-run CI instead of hardening it.

## Solution

Two complementary, defense-in-depth mitigations — no new dependencies:

1. **Process-level retry wrapper — `scripts/npm-install-with-retry.mjs` (new).**
   Runs `npm install` / `npm ci` (defaulting to `install`) and retries the whole command on transient
   failures with exponential backoff. It **reuses** `isRetryableNpmError` and `computeBackoffMs` from
   `scripts/preinstall-use-m-packages.mjs` (issue #1724) so the two scripts agree on what "flaky" means and we
   avoid code duplication (the repo enforces a jscpd duplication check). It depends only on Node built-ins
   because it runs _before_ `node_modules` exists. It streams npm's output live while buffering it to classify
   failures, and exposes a verbose mode (`NPM_INSTALL_RETRY_VERBOSE=1` / `RUNNER_DEBUG=1`) plus tunables
   (`NPM_INSTALL_MAX_ATTEMPTS`, `NPM_INSTALL_BASE_DELAY_MS`) for requirement #7.

2. **Registry-level retry budget — `.npmrc` (new).**
   Raises npm's own built-in retry settings (`fetch-retries=5`, longer timeouts). This applies **everywhere**
   npm runs — CI, local dev, and Docker image builds — so transient registry blips are absorbed before the
   process-level wrapper even has to act.

All 8 install steps in `.github/workflows/release.yml` now call the wrapper
(`node scripts/npm-install-with-retry.mjs install|ci`), fixing the bug in every place it existed (requirement #9).

## Why Not Just `nick-fields/retry` or a shell loop?

- A third-party retry action adds an external dependency and a network fetch of its own to every job; the repo's
  convention is small, audited Node scripts under `scripts/` (e.g. `preinstall-use-m-packages.mjs`,
  `wait-for-npm.mjs`). The wrapper follows that convention and is unit-tested.
- A bare `until npm install; do …; done` shell loop can't distinguish a transient `ECONNRESET` from a real
  `E404`/`ERESOLVE` and would waste minutes retrying genuine failures. The wrapper retries **only** on the
  curated transient-error set and aborts immediately on real errors.

## Implementation Plan

| Step | File                                               | Change                                                                                                          |
| ---- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1    | `scripts/npm-install-with-retry.mjs` (new)         | Process-level retry wrapper for `npm install`/`ci`, reusing issue-#1724 retry helpers; verbose mode + tunables. |
| 2    | `.npmrc` (new)                                     | Raise npm's built-in `fetch-retries` budget — applies to CI, local, and Docker.                                 |
| 3    | `.github/workflows/release.yml`                    | Route all 8 dependency-install steps through the wrapper.                                                       |
| 4    | `tests/test-npm-install-with-retry-1903.mjs` (new) | Deterministic unit test (mocked npm runner) for retry/no-retry/give-up behavior.                                |
| 5    | `docs/case-studies/issue-1903/`                    | This case study + the failed-run log.                                                                           |

## Verification

- `node tests/test-npm-install-with-retry-1903.mjs` → 4 passed, 0 failed (retry-then-success, no-retry-on-E404, give-up-after-N, first-try-success).
- `node scripts/npm-install-with-retry.mjs --version` → real spawn path streams output and reports success.
- `node scripts/npm-install-with-retry.mjs install` → installs the project's dependencies end-to-end.
- `npm run lint` and `prettier --check` pass on the new files; `release.yml` parses as valid YAML.

## Upstream / Other Repositories

The flake is in GitHub-hosted-runner ↔ npm-registry networking, not in another link-foundation repo, so there is
no external repository to file against. The pipeline **templates** (`link-foundation/*-ai-driven-development-pipeline-template`)
use the same `npm install` + `npm test` shape and would benefit from the same hardening; as with issue #1724 we
document the trigger here rather than opening template issues for an infrastructure flake. If those templates adopt
a retry wrapper later, this script is the reference implementation.

## Files in This Case Study

- `README.md` — this document.
- `data/run-27332260596-test-execution-failed.txt` — full failed-step log for run 27332260596, job `test-execution`.
