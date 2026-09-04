# F0 — Existing components and libraries that solve these problems

The issue asks to *"check online for known existing components/libraries that solve a
similar problem or can help"*. This is that survey, so the fixes in this PR are deliberate
choices rather than reinvention.

**Confidence labels:** `[VERIFIED]` = checked directly (tool run locally, or the upstream
page/API fetched in this session). `[SEARCH-ONLY]` = from search results, not
independently reproduced. `[INFERRED]` = judgement, not sourced.

---

## 1. Workflow linting (F2, F3)

| Option | Verdict |
| --- | --- |
| [`rhysd/actionlint`](https://github.com/rhysd/actionlint) | **Adopted.** Syntax, expression typing, event/context validity, plus shellcheck and pyflakes over `run:` blocks. Latest release **v1.7.12, published 2026-03-30** `[VERIFIED via GitHub API]`. |
| [`zizmor`](https://docs.zizmor.sh/) | **Adopted.** Security audits actionlint does not do: `template-injection`, `excessive-permissions`, `unpinned-uses`, `artipacked`, `self-repository`. v1.30.0 run locally `[VERIFIED]`. |
| `action-validator`, `yamllint` | Schema/style only; neither reports injection or permissions. Strictly weaker for this purpose `[INFERRED]`. |
| GitHub's own workflow syntax check | Only runs on push, only reports fatal parse errors, and cannot fail a PR before merge `[INFERRED]`. |

The two are complementary, not redundant, and this PR runs both — they overlapped on
exactly **one** of the 25 findings in F2 (the `github.head_ref` interpolation).

**Important operational detail** `[VERIFIED]`: actionlint must run as the **Docker image**.
The image bundles shellcheck; a bare binary without shellcheck on `PATH` silently skips
every `run:` block and still exits 0. Fourteen of the 25 findings are invisible to the
obvious local invocation.

## 2. Secret scanning (F8)

| Option | Verdict |
| --- | --- |
| [`secretlint`](https://github.com/secretlint/secretlint) | **Adopted.** Already a dependency — the log sanitizer calls its API — so the marginal cost is a config file, and the CI rules are then identical to the runtime rules. |
| [`gitleaks`](https://github.com/gitleaks/gitleaks) | Strong, widely used, scans history rather than just the worktree `[SEARCH-ONLY]`. Adding it would mean a second rule set that can disagree with the one the sanitizer enforces at runtime. Rejected for *this* PR; a history scan is worth its own issue. |
| `trufflehog` | Verifies candidate credentials against live services `[SEARCH-ONLY]` — valuable and orthogonal, but it makes the lint job network- and rate-limit-dependent. Rejected here. |
| GitHub secret scanning / push protection | Already active at the platform level and **not a substitute**: it covers provider-recognised patterns on push, not a repository-defined rule set, and it is not a gate this repository controls `[INFERRED]`. |

## 3. Link checking (F9)

| Option | Verdict |
| --- | --- |
| [`lycheeverse/lychee-action`](https://github.com/lycheeverse/lychee-action) | **Adopted** for the network half, matching the template. Handles caching, retries, `.lycheeignore`, and a job summary. |
| `gaurav-nelson/github-action-markdown-link-check` | Node-based, slower, no cache, less maintained `[SEARCH-ONLY]`. |
| `remark-validate-links` | Relative links only — which is the half that is *cheap to do exactly*, so this PR does that half itself in `tests/doc-links-2198.test.mjs` rather than adding a dependency for it. |
| Wayback Machine availability API | **Adopted** as the fallback (`scripts/check-web-archive.mjs`, ported from the template): a link that is dead live but archived is a documentation problem, not a build problem, and this keeps the job from going red on someone else's outage. |

The offline/online split is the design point: the offline walker **cannot flake**, so it
belongs in the ordinary test suite and gates every PR; the network check runs in its own
workflow where a third-party outage cannot block a merge.

## 4. Resilient registry pulls (F10)

| Option | Verdict |
| --- | --- |
| Template's `setup-buildx-resilient` composite | **Adopted.** Written for [template#75](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/75), with the upstream investigations in [link-foundation/box#97](https://github.com/link-foundation/box/issues/97) and [#100](https://github.com/link-foundation/box/issues/100). |
| `docker/login-action` before buildx setup | Fixes the *rate-limit* half only; an actual Docker Hub outage still fails `[INFERRED]`. |
| `nick-fields/retry` around the setup step | Generic retry, but it cannot switch registries, so it does not survive a Hub outage `[INFERRED]`. |
| `mirror.gcr.io` | **Adopted** as the fallback: a pull-through cache on infrastructure independent of Docker Hub `[SEARCH-ONLY]` for its SLA; `[VERIFIED]` that the `docker tag`-back trick makes the driver find the image under the canonical name. |

## 5. Package-manager detection (F1)

`package-manager-detector` is not replaceable here — it is a transitive dependency of
`@changesets/format`. The lever is the *input*: `[VERIFIED]` by running its `LOCKS` table
(`experiments/issue-2198/detect-package-manager.mjs`), the probe order puts `bun.lock`
ahead of `package-lock.json`, and `devEngines.packageManager` short-circuits the probe.

`corepack` / the `packageManager` field would also be read, but corepack then wants to
*provision* the manager. `devEngines.packageManager` states the requirement without
changing how npm is obtained.

## 6. Dependency auditing (F12)

| Option | Verdict |
| --- | --- |
| `npm audit --package-lock-only --audit-level=high` | **Adopted**, matching the template. No new dependency, audits the lockfile as committed, runs on the existing `schedule`. |
| `actions/dependency-review-action` | Already present, and structurally cannot cover this: PR-only, and only for dependencies the PR *changes*. Kept — the two are complementary. |
| Dependabot / Renovate alerts | Out-of-band notifications, not a gate. Useful, but they cannot fail a build `[INFERRED]`. |
| Snyk, Socket | Third-party accounts and tokens for a repository that already has a first-party answer `[INFERRED]`. |

## 7. Things search got wrong

Two claims that did not survive checking, recorded because search summaries were treated
as suspect throughout:

- That `npm approve-scripts` or an `allowScripts` entry can silence the `npm link` warning
  of F4. It cannot — every documented remedy was tried and none works, because
  `linkPkg()` never builds a policy at all (`[VERIFIED]`, matrix in
  `experiments/npm-link-allow-scripts.sh`, reported as
  [npm/cli#9951](https://github.com/npm/cli/issues/9951)).
- That switching to zizmor's recommended `uses: $/...` form is a free improvement. It is
  currently **unsatisfiable** alongside actionlint: support is open upstream as
  [rhysd/actionlint#711](https://github.com/rhysd/actionlint/issues/711) (opened
  2026-07-30) and [#732](https://github.com/rhysd/actionlint/issues/732) (2026-09-01),
  both still **open** `[VERIFIED via GitHub API]`, and v1.7.12 is the newest release. See
  F11.
