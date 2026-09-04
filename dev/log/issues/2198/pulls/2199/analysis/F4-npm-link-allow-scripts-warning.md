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

## F16 — the fix's own check went red on a rename (2026-09-04)

`test-suites` failed on run
[33890315861](https://github.com/link-assistant/hive-mind/actions/runs/33890315861)
with four failures from this very test
([`../ci-logs/run-33890315861-test-suites.log.gz`](../ci-logs/run-33890315861-test-suites.log.gz)),
under the message *"if this fails, npm fixed linkPkg() and the --ignore-scripts
workaround can be dropped"*.

npm had fixed nothing. The runners moved 11.17.0 → 11.19.0, which renamed the
log prefix and the review command and left the defect in place:

| | npm 11.17.0 | npm 11.19.0 |
| --- | --- | --- |
| warning prefix | `npm warn allow-scripts` | `npm warn install-scripts` |
| the sentence after it | `1 package has install scripts not yet covered by allowScripts:` | *identical* |
| review command | `npm approve-scripts --allow-scripts-pending` | `npm install-scripts ls` |
| bare `npm link` warns | yes | yes |
| `allowScripts` by name / by `name@version` / `--allow-scripts=<name>` | still warns | still warns |
| `--ignore-scripts` | silent, `prepare` skipped | silent, `prepare` skipped |

Reproduced under both versions side by side by
[`experiments/issue-2198/npm-allow-scripts-warning-rename.sh`](../../../../../../../experiments/issue-2198/npm-allow-scripts-warning-rename.sh);
output in [`../local/npm-warning-rename.txt`](../local/npm-warning-rename.txt).
The `test-execution` job — the one that actually runs `npm link
--ignore-scripts` — stayed green with **zero** warnings, so the workaround was
never in question. Only its detector was.

### Root cause

The test asked *"does the output contain the string `allow-scripts`?"* — a
label npm is free to re-spell — when the thing it wanted to know was *"does npm
still report this package's install scripts as unreviewed?"*. A check pinned to
a vendor's cosmetic choice reports that vendor's rename as a defect in our code.
That is the same class of untrustworthy signal this issue exists to remove, so
it is recorded as a finding rather than quietly patched.

### Fix

`warnsAboutUnreviewedScripts()` keys on `not yet covered by allowScripts` — the
sentence that states the defect, byte-identical across both releases — and keeps
either shipped prefix as a fallback signal. The failure message no longer
asserts a cause it cannot distinguish: it names both possibilities (npm fixed
it, or npm re-worded it again) and points at the experiment that tells them
apart.

Both labels npm has shipped are pinned as samples and asserted against the
matcher, so tightening it back onto one release fails immediately instead of on
the runners' next bump. Verified in both directions:

| Mutation | Result |
| --- | --- |
| matcher tightened back to `/allow-scripts/` | `❌ the unreviewed-scripts matcher recognises what npm 11.19.0 prints` |
| matcher forced to never match (npm "fixed" it) | 6 failures, led by the bare-link assertion |
| unmutated, npm 11.17.0 | 11 passed, 0 failed |
| unmutated, npm 11.19.0 | 11 passed, 0 failed |
