# Issue #2082 — CI/CD false positives, false negatives, warnings and errors

Evidence pack and deep analysis for [issue #2082](https://github.com/link-assistant/hive-mind/issues/2082) / [PR #2083](https://github.com/link-assistant/hive-mind/pull/2083).

## Contents

| Path         | What it holds                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `github/`    | Issue #2082, PR #2083, comments, reviews, recent workflow-run index                                                        |
| `ci-logs/`   | Full logs: run 29647956700 (green, 49,914 lines), run 29125268021 (red, 31,365 lines), run 29686761617 metadata            |
| `templates/` | Snapshot of `link-foundation/js-ai-driven-development-pipeline-template` CI/CD files + full file tree                      |
| `analysis/`  | Per-finding root-cause write-ups (`F1`–`F3`, `F21`–`F25`), experiment output, extracted log excerpts, published Helm index |

Reproduction experiment kept at `experiments/issue-2082-command-stream-throw.mjs`.

## Requirements extracted from the issue

| #   | Requirement (verbatim intent)                                                                | Status of analysis                                                                                         |
| --- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| R1  | Check for **all false positives** in CI/CD and fix them all                                  | 5 found (F3.1–F3.3, F5, F23)                                                                               |
| R2  | Check for **all false negatives** in CI/CD and fix them all                                  | 8 found (F1, F4, F6, F7, F8, F9, F21, F25)                                                                 |
| R3  | Check for **all warnings** in CI/CD and fix them all                                         | 11 distinct classes inventoried (F10–F20)                                                                  |
| R4  | Check for **all errors** in CI/CD and fix them all                                           | 3 real errors in a _green_ run (F1)                                                                        |
| R5  | Compare the **full file tree** against the JS pipeline template and reuse all best practices | 19-row gap table — `analysis/F2-template-gap-analysis.md`                                                  |
| R6  | **If the same issue exists in the template, report it there too**                            | 1 upstream report warranted (see "Upstream reports")                                                       |
| R7  | Follow `docs/CI-CD-BEST-PRACTICES.md`                                                        | 2 documented-but-unimplemented principles found (§11 secrets, and no timeout/cancellation sections at all) |
| R8  | Plan and execute everything in the single PR #2083                                           | This pack is the plan; execution follows                                                                   |

## Headline result

**The build is green and the release pipeline is partly broken.** The most severe finding
is not in any failing run — it is in a _passing_ one.

> The public Helm chart repository has published nothing since **2025-12-11 (v0.38.8)**
> while `package.json` is at **2.8.3**. Every `Helm Release` job in that ~7-month window
> printed `released successfully!` and went green.

Full root cause in `analysis/F1-helm-release-false-negative.md`, proven experimentally.

A second, later result has the same shape one level down: the `lint` job never read the
`tests/` tree at all (`analysis/F21-tests-tree-never-linted.md`). Enabling it exposed real
defects in 59 files, and running the resulting suite exposed `F22` — a product bug in
`getClaudeEnv()` where `CLAUDE_CODE_EFFORT_LEVEL` leaked from the parent shell into the
child Claude process, handing `effort=max` to models that support no effort levels.

A third, found while verifying the fix for the second, closes the loop: `F25` — a PR reports
**green with its own code never executed by CI**, because `detect-changes` diffs the latest
push rather than the PR, and branch protection reads the latest run. Demonstrated live on
this PR (`analysis/F25-synchronize-diff-green-untested-pr.md`), not reconstructed.

`F22` is worth reading as a method note rather than only a defect: the test that caught it
had been **passing in CI and failing locally for the same commit**, decided entirely by an
ambient environment variable that exists where hive-mind's agents run and not on the
runner. A green CI check is evidence about the runner's environment, not about the
program.

## Timeline

| Date                    | Event                                                                                                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2025-12-11              | Last real Helm publish (v0.38.8). `gh-pages` tip is still this commit today.                                                                                                                                                  |
| 2025-12-23              | `5b7e60d7` "convert CI/CD shell scripts to .mjs" replaces `helm-release.sh` (which had `set -euo pipefail`) with `helm-release.mjs`. `command-stream`'s `$` does not throw on non-zero exit → all git failures become silent. |
| 2025-12-23 → 2026-07-18 | Every `Helm Release` job green; zero charts published.                                                                                                                                                                        |
| 2026-07-10              | Run 29125268021 (red): a single failing assertion _does_ correctly redden the build — confirms the test harness's exit plumbing is sound. Line-limit warnings already show `1500/1500`.                                       |
| 2026-07-18              | Run 29647956700 (green): contains 3 `error:` lines in the Helm job, an npm double-publish race, and 593 Sentry sourcemap warnings.                                                                                            |
| 2026-07-19              | Issue #2082 filed.                                                                                                                                                                                                            |

## Findings

### Critical

| ID     | Finding                                                                                                                                                                                                                                                                                                                                 | Class                    |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **F1** | `helm-release.mjs` swallows every git failure; Helm repo frozen ~7 months while CI reports success. Wired into 2 jobs (`release.yml:1042`, `:1432`).                                                                                                                                                                                    | False negative           |
| **F4** | `version-and-commit.mjs:219` — bare `await $\`git push origin main\``. A lost push race still sets `version_committed=true` and the release proceeds for a commit never on main.                                                                                                                                                        | False negative           |
| **F5** | npm **double-publish race**. `publish-to-npm.mjs:157` verifies with `npm view` ~0.02s after publish; registry replica lag → E404 → the retry loop re-runs the _entire_ `changeset:publish`, which then legitimately fails with "cannot publish over the previously published versions". Green only because attempt 3 fit in the budget. | False positive + fragile |
| **F6** | Only **4 `timeout-minutes` across ~26 jobs**. The rest inherit GitHub's 6-hour default. `cleanup-test-repos.yml` has neither `timeout-minutes` nor `permissions` while running `gh auth refresh -s delete_repo`.                                                                                                                        | False negative           |

### High

| ID      | Finding                                                                                                                                                                                                                                                        | Class                |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **F3**  | Three CI scripts that **cannot fail**: `test-auto-fork-option.sh`, `test-global-commands.sh`, `verify-log-file-contents.sh`. `\|\| true` plus advisory `else` branches that only `echo`. Same shape at `release.yml:359,369`.                                  | False positive       |
| **F7**  | **Four files sit at exactly 1500/1500 lines** — `src/solve.mjs`, `src/claude.lib.mjs`, `src/codex.lib.mjs`, `src/telegram-solve-queue.lib.mjs`. The gate is `-gt 1500`, so a single added line reddens the build. Stale in this state for over a week.         | Imminent breakage    |
| **F8**  | `scripts/check-mjs-syntax.sh` never checks `scripts/` (only `*.mjs`, `src/`, `tests/`) — so the broken `helm-release.mjs` was never syntax-checked. The `tests/` loop also lacks `timeout 10s`.                                                                | False negative       |
| **F9**  | secretlint is in `devDependencies` and documented as principle #11, but there is **no config, no npm script, no CI step**.                                                                                                                                     | False negative       |
| **F10** | `npm warn publish "bin[…]" script name … was invalid and removed` × 10 — `package.json` `bin` values carry a `./` prefix npm strips on publish. Only visible in logs by accident (changeset dumps npm stderr only on failure). Affects the published artifact. | Warning, real impact |

### Medium / noise

| ID  | Finding                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F11 | **593 Sentry sourcemap warnings** (~1,200 log lines). The project has no build step — `build:pre` is only `chmod +x` — so there are no `.map` files at all. The step also uploads **357 test files** to Sentry every release. The feature it claims to provide does not work. |
| F12 | jscpd at **10.61% against a threshold of 11** — 0.39pp of headroom, 1,345 clones printed every run. Template uses `threshold: 0`. Test boilerplate dominates and is not ignored.                                                                                              |
| F13 | 10 jobs use `always()` instead of `!cancelled()` — hive-mind's _own_ comment at `release.yml:42` says this is wrong. Cancellation does not propagate.                                                                                                                         |
| F14 | Concurrency polarity is the inverse of the template's, with no compensating non-cancellable `main-writer` group → a rapid second push to main can cancel an in-flight publish.                                                                                                |
| F15 | `npm warn allow-scripts` × 7 — `@sentry/node-cpu-profiler` postinstall never runs, so the native profiler binary is never built. Silent degradation.                                                                                                                          |
| F16 | git `init.defaultBranch` hint × 14 blocks ≈ 98 log lines. The template silences this with workflow-level `GIT_CONFIG_COUNT/KEY_0/VALUE_0`; hive-mind does not set it.                                                                                                         |
| F17 | `DEP0040` punycode × 14, `DEP0005` Buffer × 2 — transitive/upstream, suppressible via `NODE_OPTIONS=--no-deprecation`.                                                                                                                                                        |
| F18 | `npm warn using --force` × 4 — vestigial `--force` on the Playwright MCP global install (`Dockerfile:152`, `Dockerfile.dind:157`).                                                                                                                                            |
| F19 | `warn: incorrect peer dependency "solid-js@1.9.14"` × 4 — upstream in `@link-assistant/agent`; only silenceable locally.                                                                                                                                                      |
| F20 | `softprops/action-gh-release@v2` still targets Node 20, papered over by `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24`. Actions are on `@v5`; template is on `@v6`.                                                                                                                     |

### Confirmed NOT problems (grep false positives)

Checked and cleared, so they are not chased again: the `addIgnoredFile` git hints and the
`Network error (attempt N/3)` / `Bot launch attempt N failed (409)` retry chatter are
**deliberate test fixtures** exercising retry logic against mocks, each followed by a
passing assertion. `digest-mismatch: error` and `if-no-files-found: error` are action
_input values_, not errors. All ~180 `N passed, M failed` lines have `M = 0`.

## Root-cause themes

Three mechanisms explain almost every finding:

1. **`command-stream`'s `$` is fail-soft where bash was fail-fast.** Converting shell
   scripts to `.mjs` silently dropped `set -euo pipefail` semantics. Causes F1 and F4.
   The repo already knows this — `publish-failure-classifier.mjs` documents it — but the
   knowledge was never applied to the other converted scripts.
2. **Assertions written as advisory `echo`s.** A check runs, its result is printed, and
   control falls through to success. Causes F3 and `release.yml:359,369`.
3. **Verification granularity too coarse.** F5 retries the whole publish when only the
   _verification_ needed retrying.

## Solution plan (ordered by user-visible impact)

1. **F1** — add strict exit-code checking to `helm-release.mjs`; publish from a `git
worktree` instead of switching branches in a dirty tree; fix the `.helm-packages/`
   URL; verify the published `index.yaml` afterwards; backfill missing chart versions.
2. **F5** — split retry granularity: poll `isVersionPublished` with backoff instead of
   re-running `changeset:publish`; treat `EPUBLISHCONFLICT` for the same version as success.
3. **F4** — port the template's `push-main-with-rebase-retry.sh`; assert exit codes.
4. **F7** — split the four 1500-line files before anything else touches them.
5. **F6** — `timeout-minutes` on every job in both workflows; port
   `tests/ci-timeouts.test.js` whose job-list-equality assertion prevents regressions.
6. **F3** — convert advisory `else` branches to `exit 1`; keep `|| true` only where a
   non-zero exit is genuinely expected; add `set -o pipefail`.
7. **F8** — cover `scripts/` in the syntax check; add the missing `timeout 10s`.
8. **F9** — add `.secretlintrc.json` + lint-job step (dependency already present).
9. **F13/F14** — `always()` → `!cancelled()`; adopt the template's concurrency arrangement.
10. **F10** — `npm pkg fix` the `bin` paths.
11. **F11** — drop the `./tests` upload; remove or silence the sourcemap step.
12. **F12/F15–F20** — jscpd ignores + threshold, `allowScripts` decision,
    `GIT_CONFIG_*` env, `NODE_OPTIONS=--no-deprecation`, drop `--force`, bump actions to `@v6`.
13. **R7 docs** — add timeout and cancellation sections to `docs/CI-CD-BEST-PRACTICES.md`
    and its `zh`/`hi`/`ru` translations.

## A guard against recurrence

Every fix above is a point fix for a _class_ of defect. The durable countermeasure is a
test that fails when the class reappears:

- port `tests/ci-timeouts.test.js` (catches F6 forever);
- port `tests/workflow-reliability.test.js`, which evaluates `if:` expressions against
  synthetic `needs` contexts (catches F13);
- add a lint rule or test asserting **no bare `await $\`…\``in`scripts/`** (catches the
  F1/F4 class at source) — this is the highest-leverage single addition.

## Upstream reports (R6)

The template is **not** vulnerable to F1 (it has no Helm release path) and is ahead of
hive-mind on F3/F6/F9/F13/F14. One report is warranted in the opposite direction:

**Filed:**
[`js-ai-driven-development-pipeline-template#105`](https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/105)
— **F5, the publish/verify race.** Confirmed by reading the template's live
`scripts/publish-to-npm.mjs`: `attemptPublish()` verifies once after a fixed `sleep(2000)`,
and a miss returns a failure that is _not_ marked `nonRetryable`, so `main()`'s loop
re-runs the whole `changeset publish` — which then conflicts. Same structure as hive-mind's
F5, with a wider but still unbounded race window. Reported with a deterministic
reproduction (injected runner: publish always succeeds, verification misses twice) and
hive-mind's `waitForVersionOnRegistry()` / `publishWithRetry()` split as the reference fix.

**Retracted before filing — the earlier claim in this pack was wrong.** This document
previously asserted that the template lacked `detectPublishFailure()` / `FAILURE_PATTERNS`
and was therefore exposed to the exit-code-swallowing false positive from issue #2028. That
conclusion came from reading only `scripts/publish-failure-classifier.mjs`, which does
indeed export just `NON_RETRYABLE_PATTERNS`. The template **has** both — they are defined
locally in `publish-to-npm.mjs`, and `analyzePublishResult()` checks output patterns
_before_ the exit code. The capability was present; only its location differed from
hive-mind's.

Worth recording as a method note, since it is the same error this issue is about: absence
of a symbol in the file where you expect it is not absence from the codebase. Had the
report been filed on the strength of that single-file reading, it would have been a false
positive raised in someone else's tracker.

## Debug/verbose follow-up

Every finding above reached a confirmed root cause from existing evidence, so no
speculative instrumentation is needed. The one place where more signal has standing value
is the Helm path: the fix for F1 should log each git command's exit code and assert the
published `index.yaml` contains the new version, so a future regression is red rather
than silent.
