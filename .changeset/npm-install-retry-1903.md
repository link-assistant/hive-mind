---
'@link-assistant/hive-mind': patch
---

fix(ci): retry `npm install`/`npm ci` on transient registry network errors (#1903)

CI run 27332260596 failed in the `test-execution` job when `npm install` aborted
mid-download with `npm error code ECONNRESET` / `npm error network aborted` — a
transient GitHub-runner ↔ npm-registry network drop, not a code defect. The bare
install step had no retry, so a single dropped socket failed the whole job (a
false positive).

- Add `scripts/npm-install-with-retry.mjs`: a Node-builtin-only wrapper that runs
  `npm install`/`npm ci` and retries the whole command with exponential backoff on
  transient failures only, reusing the `isRetryableNpmError`/`computeBackoffMs`
  helpers introduced for issue #1724 (no code duplication). Verbose mode via
  `NPM_INSTALL_RETRY_VERBOSE=1`; tunable via `NPM_INSTALL_MAX_ATTEMPTS` /
  `NPM_INSTALL_BASE_DELAY_MS`.
- Route all 8 dependency-install steps in `.github/workflows/release.yml` through
  the wrapper (fixing the bug in every place it existed).
- Add `.npmrc` raising npm's built-in `fetch-retries` budget, hardening local,
  CI, and Docker installs as defense in depth.
- Unit test `tests/test-npm-install-with-retry-1903.mjs` (mocked npm runner) and a
  deep case study under `docs/case-studies/issue-1903/`.
