# Existing components / libraries that solve these problems

Online research (2026-07-19) into off-the-shelf solutions for each root cause, so the
fixes in this PR are deliberate choices rather than reinvention.

**Confidence labels:** `[VERIFIED]` = primary source fetched and quoted. `[SEARCH-ONLY]` =
from search summaries, not independently fetched. `[INFERRED]` = judgement, not sourced.

> One search summary claimed zizmor had shipped a `timeout-minutes` audit. Fetching the
> docs **disproved** it. Search summaries were treated as suspect throughout.

## 1. Helm chart publishing

| Option                                                                        | Verdict                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`helm/chart-releaser-action`](https://github.com/helm/chart-releaser-action) | Official `helm/` org, v1.7.0 (Jan 2025), ~664★. Packages charts, creates GitHub Releases, commits `index.yaml` to `gh-pages`. `[VERIFIED]` Exactly replaces the hand-rolled script. No native OCI (`skip_upload` leaves that to you).                                                                    |
| OCI → GHCR via `helm push`                                                    | `[VERIFIED]` Helm's own docs: _"It is recommended to use container registries with OCI support to store and share chart packages."_ OCI went GA in Helm 3.8.0 `[SEARCH-ONLY]`. Removes the entire failure class — no `index.yaml`, no `gh-pages`, no push race, and a failed `helm push` exits non-zero. |
| `peaceiris/actions-gh-pages`, `stefanzweifel/git-auto-commit-action`          | Generic transports that know nothing about Helm; you would still hand-roll `helm repo index`. Strictly worse here. `[INFERRED]`                                                                                                                                                                          |

**Decision for this PR:** keep the `gh-pages` contract (existing users run
`helm repo add link-assistant https://link-assistant.github.io/hive-mind`; switching to
OCI is a breaking change for them) but fix the script properly — strict exit codes,
worktree isolation, post-publish verification. Migrating to `chart-releaser-action` or
OCI is worth a **follow-up issue**, not a change smuggled into a CI-correctness PR.

## 2. Fail-fast shell execution — the root cause

`command-stream` is the outlier. Every mainstream alternative throws by default.

| Library                                                    | Throws on non-zero by default?                                                              | Opt-out         | Evidence                                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [`execa`](https://github.com/sindresorhus/execa)           | **Yes**                                                                                     | `reject: false` | `[VERIFIED]` _"When the subprocess fails, the promise returned by `execa()` is rejected with an `ExecaError` instance."_ |
| [`google/zx`](https://google.github.io/zx/process-promise) | **Yes**                                                                                     | `.nothrow()`    | `[VERIFIED]` _"Changes behavior of `$` to not throw an exception on non-zero exit codes."_                               |
| [`dax-sh`](https://github.com/dsherret/dax)                | **Yes**                                                                                     | `.noThrow()`    | `[SEARCH-ONLY]`                                                                                                          |
| `node:child_process`                                       | **Depends on the API** — `execSync`/`execFileSync` throw; `spawn`/`spawnSync`/`exec` do not | —               | `[INFERRED]`                                                                                                             |

**Decision for this PR:** `scripts/run-command.lib.mjs` wraps `child_process.spawn` with an
explicit `runStrict`. This mirrors the pattern the repo _already_ adopted in
`scripts/publish-to-npm.mjs` and `scripts/npm-install-with-retry.mjs` (issues #2028, #1903),
uses only Node built-ins so it cannot be broken by `node_modules` state, and adds no
dependency. Adopting `execa` repo-wide is a larger migration worth its own issue.

## 3. Verifying an npm publish landed

**The lag is real but under-documented.** No authoritative npm SLA found. Corroborating
`npm/cli` issues: [#3424](https://github.com/npm/cli/issues/3424),
[#9043](https://github.com/npm/cli/issues/9043) (still missing after 5 minutes of retries),
[#593](https://github.com/npm/cli/issues/593). `[SEARCH-ONLY]` The usual explanation is a
Fastly CDN metadata TTL of ~300s — **community folklore, not an npm source**; the
phenomenon is well-attested, the number is not.

**Critical caveat — a likely misdiagnosis.** `[SEARCH-ONLY]` Many 2025–2026 "E404 right
after publish" reports are **not** lag: with Trusted Publishing, a failed OIDC handshake
makes the registry treat the client as anonymous, surfacing as a **misleading 404**.
Requires **npm ≥ 11.5.1**. Node 22 ships npm 10; Node 24 ships npm 11. A retry loop will
never fix that. → **Verify the publish job's npm version before assuming lag.**

`[VERIFIED absence]` No purpose-built "verify npm publish landed" action or library exists.
The community pattern is a hand-rolled `npm view` poll with backoff.

**Decision for this PR:** the current code's defect is not that it verifies — verification
is the #2028 protection and must stay — it is the **retry granularity**: a failed
verification re-runs the entire `changeset:publish`. Fix = poll verification with backoff,
never republish after a publish that reported success, and treat a same-version
`EPUBLISHCONFLICT` as success. Also check the runner's npm version against the OIDC
caveat above.

## 4. Rebase-retry push to a busy main

- [`stefanzweifel/git-auto-commit-action`#170](https://github.com/stefanzweifel/git-auto-commit-action/issues/170) "Retry for non-fast-forward pushes" is **CLOSED**, but the closing rationale could not be retrieved — implemented vs wontfix is **unknown**. `[VERIFIED closed, resolution unverified]`
- `ad-m/github-push-action` — **not fetched; no evidence either way.**
- A marketplace "Git Rebase Push" action targets exactly this, but maintainer/star/cadence unverified. `[SEARCH-ONLY]`

`[INFERRED]` **No mature, well-known action does this.** The two real options are a small
hand-rolled `git pull --rebase && git push` retry loop, or — architecturally cleaner —
a GitHub Actions **`concurrency:` group** so two runs never race for main at all.

**Decision for this PR:** do both. The concurrency fix is already required by F14
(adopt the template's non-cancellable `main-writer` group), and it addresses the _cause_;
the exit-code assertion on the push addresses the _silent failure_.

## 5. Enforcing `timeout-minutes` on every job

**Nothing ships this today.** `[VERIFIED negative]`

- **zizmor** — the full audit list at <https://docs.zizmor.sh/audits/> contains **no**
  `timeout-minutes` audit. Issue [#1023](https://github.com/zizmorcore/zizmor/issues/1023)
  requesting it is **OPEN** with an open PR. zizmor **does** cover the other two asks:
  `unpinned-uses` (action pinning) and `excessive-permissions` / `undocumented-permissions`.
- **actionlint** — issue [#49](https://github.com/rhysd/actionlint/issues/49) requesting a
  `timeout-minutes` rule is **OPEN**. No such rule exists.
- **OpenSSF Scorecard** — not fetched; no claim made.

**Decision for this PR:** port the template's `tests/ci-timeouts.test.js` as the custom
check, and watch zizmor #1023 to replace it later.

> **Correctness caveat for that check** `[SEARCH-ONLY]`: jobs that call a reusable workflow
> via `uses:` **do not support `timeout-minutes`** — it must be set inside the called
> workflow. A naive "every job needs `timeout-minutes`" assertion produces false positives
> on reusable-workflow callers. Ironically, writing the check carelessly would introduce a
> new false positive while fixing a false negative.

## 6. Sentry sourcemaps with no build step

`[VERIFIED]` Sentry's [Node source-maps docs](https://docs.sentry.io/platforms/javascript/guides/node/sourcemaps/)
are organised entirely around bundlers/transpilers (webpack, Vite, Rollup, esbuild,
TypeScript, UglifyJS, SystemJS). For anything else the only guidance is _"we recommend you
upload them using Sentry CLI."_ `[VERIFIED absence]` The docs **never address** the
no-build-step case.

`[INFERRED]` For plain ESM Node shipped unbundled and untranspiled, a sourcemap is the
identity function: the executed file is byte-identical to the authored file, so stack
traces already carry real filenames and line numbers. Sentry accepts the upload; it
changes no stack trace.

**Decision for this PR:** remove the step. It costs an auth token, a CI dependency, 593
warnings and ~1,200 log lines per release, and uploads 357 test files, for no debugging
benefit. Revisit if a bundling step is ever introduced.

## Summary

| #   | Problem            | Chosen approach                               | Off-the-shelf alternative deferred                   |
| --- | ------------------ | --------------------------------------------- | ---------------------------------------------------- |
| 1   | Helm publish       | Fix in place: strict + worktree + verify      | `chart-releaser-action` / OCI-GHCR → follow-up issue |
| 2   | Fail-fast shell    | `run-command.lib.mjs` on `node:child_process` | `execa` repo-wide → follow-up issue                  |
| 3   | npm publish verify | Fix retry granularity; check npm ≥ 11.5.1     | none exists                                          |
| 4   | Push race          | `concurrency:` group + exit-code assertion    | none mature                                          |
| 5   | timeout-minutes    | Port `ci-timeouts.test.js`                    | zizmor #1023 (open)                                  |
| 6   | Sentry sourcemaps  | Remove the step                               | n/a                                                  |

## Claims deliberately left unverified

Recorded so nobody later mistakes them for settled facts: the closing rationale of
git-auto-commit-action #170; `ad-m/github-push-action`'s retry behaviour; OpenSSF
Scorecard's check list; the 5-minute npm CDN `max-age` figure; `node:child_process`
per-API throw semantics; dax's exact `noThrow` wording.
