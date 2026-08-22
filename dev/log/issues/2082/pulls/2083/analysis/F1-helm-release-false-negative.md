# F1 — Helm release silently publishes nothing (CRITICAL false negative)

**Severity:** Critical · **Class:** False negative (real failure reported as success)
**Status:** Root cause proven experimentally and confirmed against production data.

## Symptom

The `Helm Release` job is **green on every run**, and the script prints:

```
Helm chart version 2.8.3 released successfully!
```

…while publishing **nothing**. The public Helm repository has been frozen since
**2025-12-11**.

## Production evidence

```
$ curl -sL https://link-assistant.github.io/hive-mind/index.yaml
    created: "2025-12-11T21:46:20.260871516Z"
    version: 0.38.8      <-- newest entry
```

```
$ git ls-remote origin gh-pages
dd31d9411718e9cd4dce788ceb9ce4afb35a8160  refs/heads/gh-pages
$ git log -1 --format='%ci %s' dd31d941
2025-12-11 21:46:20 +0000 Release Helm chart version 0.38.8
```

Meanwhile `package.json` is at **2.8.3**. So `helm install link-assistant/hive-mind`
gives users a chart that is ~7 months and ~2 major versions stale, and every CI run in
that window claimed success.

## Errors visible in the green log

From `ci-logs/run-29647956700-success.log` (job `Helm Release`, lines 49804–49880):

```
14:47:04.8200804Z error: Your local changes to the following files would be overwritten by checkout:
14:47:04.8201571Z 	helm/hive-mind/Chart.yaml
14:47:04.8202125Z Please commit your changes or stash them before you switch branches.
14:47:04.8202731Z Aborting
...
14:47:05.6801328Z [main f723e208] Release Helm chart version 2.8.3     <-- committed to MAIN, not gh-pages
14:47:06.3860616Z cp: cannot stat '.helm-packages/*.tgz': No such file or directoryEverything up-to-date
14:47:06.3985422Z error: pathspec '-' did not match any file(s) known to git
14:47:06.3993096Z Helm chart version 2.8.3 released successfully!      <-- and yet
```

Note `Everything up-to-date` on the push: the local `gh-pages` ref was fetched but never
advanced, so nothing was published.

## Root cause

`scripts/helm-release.mjs` runs every git command as a bare `await $\`...\``using`command-stream`. **`command-stream`'s `$`does not throw on a non-zero exit code** — it
resolves with a result object carrying`.code`. The script never inspects `.code`, so the
surrounding `try/catch` (lines 59–137) is decorative: no git failure can ever reach it.

Verified experimentally (`analysis/command-stream-throw-experiment.log`,
source `experiments/issue-2082-command-stream-throw.mjs`):

```
error: pathspec 'definitely-not-a-branch-2082' did not match any file(s) known to git
threw          = false
result.code    = 1
VERDICT: DOES NOT THROW -> failures are silently ignored
```

### Failure chain

1. `gh-pages` was created from main's tree, so it **also contains
   `helm/hive-mind/Chart.yaml`** (confirmed: `git ls-tree -r FETCH_HEAD` lists the full
   repo tree).
2. `helm-release.mjs:68-71` rewrites `helm/hive-mind/Chart.yaml` in the working tree.
3. `helm-release.mjs:105` `git checkout gh-pages` therefore **aborts** — it would
   overwrite the modified file.
4. `$` swallows the failure. Execution continues **still on `main`**.
5. `helm-release.mjs:110-111` `cp`/`helm repo index .` build `index.yaml` in the main
   working tree.
6. `helm-release.mjs:118-120` commits `index.yaml` + the `.tgz` **onto `main`** (local
   only) — see `[main f723e208]` in the log.
7. `helm-release.mjs:125` `git push origin gh-pages` pushes the _unchanged_ local
   `gh-pages` ref → `Everything up-to-date`. **Nothing is published.**
8. `helm-release.mjs:130` `git checkout -` fails (`pathspec '-'`) — swallowed.
9. Script falls through to the success message and exits 0. Job is green.

## Regression origin

Commit `5b7e60d7` — _"refactor: convert CI/CD shell scripts to .mjs format"_
(2025-12-23) replaced `scripts/helm-release.sh` with `scripts/helm-release.mjs`.

The shell original began with:

```bash
#!/usr/bin/env bash
set -euo pipefail
```

Under `set -e` the failing `git checkout gh-pages` **aborted the job loudly**. The `.mjs`
rewrite silently dropped that guarantee, because `command-stream` has fail-soft
semantics where bash had fail-fast. This is the exact "false negative introduced by a
refactor" pattern.

Timeline:

| Date                    | Event                                                                        |
| ----------------------- | ---------------------------------------------------------------------------- |
| 2025-12-11              | Last successful Helm publish (v0.38.8) — gh-pages tip to this day            |
| 2025-12-23              | `5b7e60d7` converts `helm-release.sh` → `.mjs`, dropping `set -euo pipefail` |
| 2025-12-23 → 2026-07-18 | Every `Helm Release` job green; zero charts published                        |
| 2026-07-18              | Run 29647956700 — green, "released successfully", index still at 0.38.8      |

## Blast radius — the same script is wired into two jobs

`.github/workflows/release.yml`:

- line 1042 — job `helm-release`
- line 1432 — job `helm-release-instant`

Both call `node scripts/helm-release.mjs`, so both are affected. Any fix must cover both
paths (they share the one script, so fixing the script fixes both).

## Proposed fix

1. **Make failures fatal.** Add a strict wrapper that checks `.code` after every command
   and throws, e.g. `const run = async (result) => { if (result.code !== 0) throw new
Error(...) }`, or use `$\`...\`.run({ capture: true })`consistently and assert. This
restores`set -euo pipefail` semantics.
2. **Stop the checkout conflict at the source.** Publish from a dedicated worktree or a
   clean temp clone (`git worktree add ../gh-pages gh-pages`) instead of switching
   branches in the dirty release checkout. This is the standard approach and removes the
   whole class of "dirty tree blocks checkout" failures.
3. **Fix the index URL.** The generated entry points at
   `https://link-assistant.github.io/hive-mind/.helm-packages/hive-mind-2.8.3.tgz`
   because the `cp` to the repo root failed; the `.tgz` must sit next to `index.yaml`.
4. **Verify after publishing** (turns any future regression back into a red build):
   re-fetch `index.yaml` from the Pages URL and assert the released version is present.
5. **Replace `git checkout -`** with an explicit branch name captured up front.
6. **Backfill** the missing chart versions into the gh-pages index once fixed.

## Related finding

`scripts/version-and-commit.mjs:219` has the identical defect on a release-critical path:

```js
await $`git push origin main`;
console.log('Version bump committed and pushed to main');
setOutput('version_committed', 'true');
```

If the push loses a race (non-fast-forward), the failure is swallowed and the workflow
reports `version_committed=true` for a commit that was never pushed. Same fix class.
