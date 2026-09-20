# F2 — Gap analysis vs `link-foundation/js-ai-driven-development-pipeline-template`

Template snapshot cloned to `templates/` (see `templates/template-file-tree.txt`).
hive-mind tree in `analysis/hive-mind-file-tree.txt`.

Both repos share ancestry — the template's `docs/case-studies/` explicitly cites
hive-mind issues (#1274, #1278, #1593, #1730, #960). The template has since hardened
several correctness properties that hive-mind never back-ported.

## Gap table

| #   | Category                       | Template                                                                                                                                                             | hive-mind                                                                                                                        | Risk class                                                             | Severity |
| --- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------- |
| 1   | Job timeouts                   | `timeout-minutes` on all release jobs                                                                                                                                | **4 `timeout-minutes` for ~26 jobs** (verified by grep) — rest inherit GitHub's 6-hour default                                   | false negative                                                         | Critical |
| 2   | Timeout enforcement test       | `tests/ci-timeouts.test.js` asserts per-job timeout _and_ job-list equality, so a new untimed job fails CI                                                           | none                                                                                                                             | false negative                                                         | Critical |
| 3   | Main-branch concurrency        | `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}` + non-cancellable `main-writer-*` group on `release`/`instant-release` (`template-release.yml:384,489`) | `cancel-in-progress: ${{ github.ref == 'refs/heads/main' }}` (`release.yml:52`) — **opposite polarity**, no `main-writer` group  | data loss: a rapid second push to main can cancel an in-flight publish | Critical |
| 4   | Push-to-main race              | `scripts/push-main-with-rebase-retry.sh` (`set -euo pipefail`, pull --rebase + retry)                                                                                | `version-and-commit.mjs:219` bare `await $\`git push origin main\``                                                              | false negative (see F1 — `$` never throws)                             | Critical |
| 5   | Post-publish smoke test        | `scripts/smoke-test-package.mjs` run after every publish                                                                                                             | absent                                                                                                                           | false positive: broken package ships green                             | High     |
| 6   | Release-needed self-healing    | `check-changesets.mjs` + `check-release-needed.mjs` query the **npm registry**                                                                                       | inline `find .changeset -name '*.md' \| wc -l`                                                                                   | false negative: a failed release is never retried                      | High     |
| 7   | `check-mjs-syntax.sh` coverage | loops `src scripts tests`, counts checked files                                                                                                                      | **`scripts/` is never syntax-checked**; `tests/*.mjs` loop lacks `timeout 10s`                                                   | false negative                                                         | High     |
| 8   | Cancellation propagation       | `!cancelled()` throughout                                                                                                                                            | 10 jobs still use `always()` — hive-mind's _own_ comment at `release.yml:42` says this is wrong                                  | false negative                                                         | High     |
| 9   | Secrets scanning               | `npx secretlint "**/*"` step + `.secretlintrc.json`                                                                                                                  | secretlint is in `devDependencies` but there is **no config, no npm script, no CI step** — yet it is documented as principle #11 | false negative                                                         | High     |
| 10  | `\|\| true` in CI test scripts | n/a                                                                                                                                                                  | `test-auto-fork-option.sh`, `test-global-commands.sh`, `verify-log-file-contents.sh` pipe assertions to `\|\| true`              | false positive: these "tests" cannot fail                              | High     |
| 11  | Duplication threshold          | `.jscpd.json` `threshold: 0`, `format: console`                                                                                                                      | `threshold: 11`, `format: ["javascript"]` — 11% duplication tolerated, non-JS unscanned                                          | false negative                                                         | Medium   |
| 12  | git `init.defaultBranch` noise | sets `GIT_CONFIG_COUNT/KEY_0/VALUE_0=init.defaultBranch=main` at workflow env level                                                                                  | **not set** — hence the repeated `hint: to use in all of your new repositories…` noise in every job                              | warning                                                                | Medium   |
| 13  | Broken-link CI                 | `links.yml` (lychee + web-archive fallback) + `.lycheeignore`                                                                                                        | absent                                                                                                                           | false negative                                                         | Medium   |
| 14  | Action pinning                 | `actions/checkout@v6`, `setup-node@v6`                                                                                                                               | `@v5` throughout + `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` workaround (`release.yml:50`)                                      | warning (Node 20 deprecation notices)                                  | Medium   |
| 15  | Per-test timeout               | `--test-timeout=30000` / `bun test --timeout 30000`                                                                                                                  | no timeout logic in `scripts/run-tests.mjs`                                                                                      | false negative                                                         | Medium   |
| 16  | Workflow-property tests        | `workflow-reliability.test.js` evaluates `if:` expressions against synthetic `needs` contexts; plus `tag-prefix`, `release-badge`, `docker-publish` tests            | only `tests/test-docker-release-order.mjs`                                                                                       | false negative                                                         | Medium   |
| 17  | Matrix breadth                 | node/bun/deno × 3 OS                                                                                                                                                 | ubuntu + node only                                                                                                               | false negative                                                         | Medium   |
| 18  | Job `permissions`              | restrictive workflow-level default                                                                                                                                   | none; `cleanup-test-repos.yml` has no `permissions` **and** no `timeout-minutes` while running `gh auth refresh -s delete_repo`  | security / warning                                                     | Medium   |
| 19  | Docs coverage                  | `BEST-PRACTICES.md` §13 timeouts, §14 cancellation                                                                                                                   | `CI-CD-BEST-PRACTICES.md` has **no timeout and no cancellation section** (headings jump 10→11→12)                                | —                                                                      | Medium   |

### Nuance on #3

This is not a typo on either side — both repos comment the choice deliberately.
hive-mind: _"When multiple commits are pushed quickly, we want the latest to release, not
wait."_ The template chose the opposite **and** added the serialized non-cancellable
`main-writer` group so that newest-wins still holds for checks while a publish can never
be interrupted. The template's arrangement is strictly safer and achieves the same intent;
hive-mind's current setting can cancel a run between `git push` and `npm publish`.

## Where hive-mind is AHEAD of the template

`scripts/publish-failure-classifier.mjs` is **stronger** than the template's: it adds
`detectPublishFailure()` / `FAILURE_PATTERNS` for content-based detection of
`changeset publish` swallowing npm's exit code (hive-mind issue #2028). The template only
has `NON_RETRYABLE_PATTERNS`.

→ **This should be reported upstream to the template repo** (issue requirement: "if the
same issue is found in template report issue also in templates"). The template is
vulnerable to the exact false-negative class that hive-mind already fixed.

## Prioritized plan

1. Fix `helm-release.mjs` exit-code checking (F1) — highest user-visible impact.
2. Replace `git push origin main` with a rebase-retry wrapper + exit-code assertion.
3. Add `timeout-minutes` to all jobs in both workflows; port `ci-timeouts.test.js` so the
   list-equality assertion prevents regressions.
4. Adopt the template's concurrency arrangement (`!= main` + `main-writer` group).
5. Fix `check-mjs-syntax.sh` to cover `scripts/`, add `timeout 10s`.
6. Remove `|| true` from CI-invoked verification scripts.
7. Wire up secretlint (dependency already installed, doc already promises it).
8. Swap remaining `always()` → `!cancelled()`.
9. Set `GIT_CONFIG_*` env to silence the git hint noise.
10. Bump actions to `@v6` (also removes the `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` workaround).
11. Lower jscpd threshold, restore `format: console`.
12. Port `links.yml`, `smoke-test-package.mjs`, `check-release-needed.mjs`,
    `workflow-reliability.test.js`.
13. Add timeout + cancellation sections to `docs/CI-CD-BEST-PRACTICES.md` (all 4 languages).
