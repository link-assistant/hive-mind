# Case Study: Issue #1724 — Fix CI/CD

## Summary

CI run [25109962685](https://github.com/link-assistant/hive-mind/actions/runs/25109962685/job/73581228475) on `main`
failed in the `test-suites` job. The root cause is a **flaky `npm install -g` triggered by `use-m`** during test
file imports — npm intermittently fails with `ENOTEMPTY: directory not empty, rmdir` when reinstalling a global
package whose previous install left files behind.

Tests do not actually need the package being installed (`command-stream`); the install is a side effect of importing
production source files from a test file.

## Timeline of Events

| Time (UTC)          | Event                                                                                                                                                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-29 12:53:01 | Push to `main` (sha `074a781d`) triggers run 25109962685.                                                                                                                                                                                                                                                       |
| 2026-04-29 12:54:13 | `test-suites` job starts on `ubuntu-24.04`, Node 24.14.1, npm 11.11.0.                                                                                                                                                                                                                                          |
| 2026-04-29 12:54:33 | `npm install` finishes; `npm test` starts (`scripts/run-tests.mjs --suite default`).                                                                                                                                                                                                                            |
| 2026-04-29 12:54:33 | `[1/75] tests/limits-display.test.mjs` — passes.                                                                                                                                                                                                                                                                |
| 2026-04-29 12:54:36 | `[2/75] tests/<…>` — passes.                                                                                                                                                                                                                                                                                    |
| 2026-04-29 12:54:37 | `[3/75] tests/test-active-branch-runs-buffer-1722.mjs` starts.                                                                                                                                                                                                                                                  |
| 2026-04-29 12:54:39 | The test file imports `src/github-merge.lib.mjs` → `src/github.lib.mjs` (top-level `await use('command-stream')` via `use-m`). `npm install -g command-stream-v-latest@npm:command-stream@latest` fails with `ENOTEMPTY`. The whole test file aborts; `run-tests.mjs` exits 1; the job ends with `exit code 1`. |

A previous run (25072975006, 2026-04-28 19:21) failed in the same step with a sibling symptom: `Failed to resolve the
path to 'getenv' from '…/getenv-v-latest'` — also a `use-m` install path race, this time leaving a partial install.

## Verbatim Error (run 25109962685)

```
[3/75] tests/test-active-branch-runs-buffer-1722.mjs
<anonymous_script>:557
        throw new Error(`Failed to install ${packageName}@${version} globally.`, { cause: error });

Error: Failed to install command-stream@latest globally.
    at ensurePackageInstalled (eval at <anonymous>
        (file:///home/runner/work/hive-mind/hive-mind/src/playwright-mcp.lib.mjs:4:27),
     <anonymous>:557:15)
  [cause]: Error: Command failed: npm install -g command-stream-v-latest@npm:command-stream@latest
  npm error code ENOTEMPTY
  npm error syscall rmdir
  npm error path /opt/hostedtoolcache/node/24.14.1/x64/lib/node_modules/command-stream-v-latest/js/src/commands
  npm error errno -39
  npm error ENOTEMPTY: directory not empty, rmdir '…/command-stream-v-latest/js/src/commands'
```

Full logs are in `data/run-25109962685-failed.txt` and `data/run-25072975006-failed.txt`. The current `use-m` source
(`data/use-m-source.js`) shows that `ensurePackageInstalled` issues a single `npm install -g <alias>@npm:<pkg>@latest`
with no retry.

## Requirements (from the issue)

1. Find the root cause of the failing CI run.
2. Fix it.
3. Apply the same kind of best practice across all GitHub workflow / CI scripts; if the same bug exists in the
   templates, report it there.
4. Compile data and a deep case study under `./docs/case-studies/issue-{id}`.
5. If we can't pinpoint the root cause, add debug output / verbose mode for the next iteration.
6. Where the cause is in another repo we can file issues against, file an issue with reproducer + workaround +
   suggested fix.

## Root Cause

`use-m`'s `ensurePackageInstalled` runs `npm install -g <alias>@npm:<pkg>@<version>` for any
`await use('<pkg>@latest')` call. Several modules in `src/` perform this at module top level
(e.g. `src/github.lib.mjs`, `src/playwright-mcp.lib.mjs`):

```js
if (typeof globalThis.use === 'undefined') globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
const { $ } = await use('command-stream');
```

Therefore **every test file that transitively imports one of those modules triggers an `npm install -g` of
`command-stream@latest` (and friends)** — even when the test never uses `$`.

`npm install -g` of an existing global package occasionally fails with `ENOTEMPTY` on Ubuntu runners. This is a
long-standing npm rmdir race when contents of `node_modules/<pkg>/<…>` are still being written or held open while npm
tries to remove the previous install (npm/cli#4825 and similar). `use-m` does **not** retry; the first failure ends
the test file with exit 1.

## Why It's Hard to Reproduce

- Only happens when the package is already present from a previous test or job, so first invocation passes.
- `--depth=1` checkouts and the GitHub-hosted runner cache make timing non-deterministic.
- Tests run sequentially in `scripts/run-tests.mjs`, so the failing import is the same in every run, but the npm race
  may or may not fire.

## Solution

Two complementary mitigations:

1. **Pre-install `use-m` "latest" packages once with retries before running tests.**
   `use-m` keys the early-return on `installedVersion === latestVersion`. If we pre-install
   `command-stream@latest`, `getenv@latest`, `@dotenvx/dotenvx@latest`, `links-notation@latest`,
   `telegraf@latest`, `yargs@latest`, `zx@latest` with a retry loop, every later `await use('<pkg>')` in tests is a
   no-op and never touches `npm install -g`.

2. **Wire that step into `test-suites` and `test-execution`** workflow jobs (the two CI jobs that hit `npm test` /
   `solve.mjs`).

The retry script also gives us a single place to add verbose logging for future failures (requirement #5 above).

## Why Not Patch `use-m`

`use-m` is a separate project (link-foundation/use-m). The right place to add retry behaviour is upstream, but our CI
must not depend on a synchronous fix there. We address that separately (see "Upstream Issue" below).

## Implementation Plan

| Step | File                                             | Change                                                                                                                         |
| ---- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 1    | `scripts/preinstall-use-m-packages.mjs` (new)    | Pre-install the `latest` packages used by `use-m` with retry on `ENOTEMPTY`/`EBUSY`/network errors; emit verbose progress.     |
| 2    | `package.json`                                   | Add a `preinstall:use-m` npm script that calls the above.                                                                      |
| 3    | `.github/workflows/release.yml`                  | Run `node scripts/preinstall-use-m-packages.mjs` after `npm install` in `test-suites` and `test-execution`, before `npm test`. |
| 4    | `tests/test-preinstall-use-m-packages.mjs` (new) | Unit-test the retry helper deterministically (no real npm calls).                                                              |
| 5    | `docs/case-studies/issue-1724/`                  | This case study.                                                                                                               |

## Templates

Both `link-foundation/js-ai-driven-development-pipeline-template` (saved under `templates/js-template/`) and
`link-foundation/rust-ai-driven-development-pipeline-template` (`templates/rust-template/`) define their `test`
jobs with `npm install` then `npm test` and **do not** pre-install `use-m` packages. That's correct for them today
because their template code does not currently use `use-m` `@latest` aliases at module load time (the rust template
doesn't run JS tests at all). The flake is hive-mind-specific until those templates start using `use-m`.

If/when those templates adopt the same `await use('<pkg>@latest')` pattern at module load, the same fix should be
back-ported. We are **not** opening template issues now to avoid noise; this case study documents the trigger
condition for future maintainers.

## Upstream Issue

A separate issue should be filed against `link-foundation/use-m` proposing a built-in retry on `ENOTEMPTY`/`EBUSY`
errors with exponential backoff (3 attempts is sufficient based on observed behaviour). That issue is tracked as
follow-up; this PR fixes the symptom in hive-mind without waiting on upstream.

## Files in This Case Study

- `README.md` — this document
- `data/run-25109962685-failed.txt` — full failed-step log for the run named in issue #1724
- `data/run-25072975006-failed.txt` — earlier failure with sibling symptom (`getenv-v-latest`)
- `data/use-m-source.js` — snapshot of `https://unpkg.com/use-m/use.js` showing the no-retry install path
- `templates/js-template/release.yml` — JS template workflow as of investigation
- `templates/rust-template/release.yml` — Rust template workflow as of investigation
