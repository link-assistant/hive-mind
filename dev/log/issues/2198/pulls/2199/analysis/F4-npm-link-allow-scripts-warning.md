# F4 — Four `npm warn allow-scripts` lines per run, with unactionable advice

**Severity:** Medium · **Class:** Warning (upstream defect; workaround applied)
**Status:** Root cause found in npm's source, reported upstream as
[npm/cli#9951](https://github.com/npm/cli/issues/9951); silenced in `ca8eacd6`.

## Symptom

The `test-execution` job printed this on every run, under the runners' npm 11.17.0
([`../ci-logs/run-33861728465-checks-and-release.log`](../ci-logs/run-33861728465-checks-and-release.log.gz)
lines 20354–20357):

```
npm warn allow-scripts 1 package has install scripts not yet covered by allowScripts:
npm warn allow-scripts   @link-assistant/hive-mind@2.16.0 (prepare: husky)
npm warn allow-scripts
npm warn allow-scripts Run `npm approve-scripts --allow-scripts-pending` to review, or `npm approve-scripts <pkg>` to allow.
```

## The advice does not work

Every documented remedy was tried; the full matrix is kept as a runnable script at
[`experiments/npm-link-allow-scripts.sh`](../../../../../../../experiments/npm-link-allow-scripts.sh)
and its output at
[`../local/npm-link-allow-scripts.txt`](../local/npm-link-allow-scripts.txt).

| Attempt | Result |
| --- | --- |
| `npm approve-scripts --allow-scripts-pending` | `No packages with unreviewed install scripts` |
| `allowScripts` in `package.json` (bare name) | warning unchanged |
| `allowScripts` in `package.json` (`name@version`) | warning unchanged |
| `allow-scripts` in `.npmrc` | warning unchanged |
| `--allow-scripts=<name>` on the command line | warning unchanged |
| `--ignore-scripts` | warning gone |

## Root cause

In npm's `lib/commands/link.js`, the code path taken when linking the *current* package
into the global prefix is `linkPkg()`. It never calls `resolveAllowScripts()`, so no
allow-scripts policy is ever constructed and none reaches Arborist — which then reports
the package as "not yet covered" no matter what the user configures. Its sibling
`linkInstall()` (the `npm link <pkg>` direction) does call it.

That is why every configuration knob is inert: the warning is emitted by a code path with
no policy input.

Reported upstream with a reproducer, the root cause and a suggested patch:
[npm/cli#9951](https://github.com/npm/cli/issues/9951).

## Fix

`--ignore-scripts` on the `npm link` invocation. It is free here: the only script it
skips is this package's own `prepare: husky`, which the install step of the same job has
already run, and Git hooks have no bearing on whether the global bin commands resolve.

`tests/test-issue-2198-npm-link-scripts.mjs` reproduces the warning from scratch against
whatever npm is on `PATH`. When npm fixes `linkPkg()`, the test fails and tells us the
workaround can be removed — the workaround is dated, not permanent.
