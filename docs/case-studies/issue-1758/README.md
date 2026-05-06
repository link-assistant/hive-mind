# Issue #1758 — Test cleanup, dry-run safety, and `--isolated screen` migration

> Source: <https://github.com/link-assistant/hive-mind/issues/1758>
>
> Branch / PR: [`issue-1758-bc8ede139a7b`](https://github.com/link-assistant/hive-mind/tree/issue-1758-bc8ede139a7b) · [PR #1759](https://github.com/link-assistant/hive-mind/pull/1759)

## 1. Context

The issue was filed after the maintainer noticed leftover GNU `screen` sessions on a development host:

```
box@f5de74ec9d22:~$ screen -ls
There are screens on:
    3311303.5311452a-2589-4956-b804-9a7323d5053d
    2959889.161eb0ee-c0da-435a-a80b-cf38dd61dabf
    2798203.98ef35d4-d49a-437c-a01e-7f2396b103a5
    2262804.3003ba2b-34fb-41a2-849e-75cc70a02173
    2236744.f77e704f-6325-42ad-a3b8-520275bb6c18
    761656.solve-link-assistant-hive-mind-539
6 Sockets in /run/screen/S-box.
```

Two distinct naming patterns appear:

- UUID-style names (e.g. `5311452a-…`) come from `--isolated screen` runs through
  `src/isolation-runner.lib.mjs` (see `generateSessionId()`).
- `solve-link-assistant-hive-mind-539` (and the maintainer mentions
  `hive-konard`/`hive-link-assistant-hive-mind` from the same screenshot) come
  from the legacy `start-screen` command in `src/start-screen.mjs`.

The maintainer reports those legacy sessions were running in `--dry-run` mode
and were closed manually. The fact that _any_ screen sessions stayed around
after exiting the test/dev work motivated the issue.

## 2. Requirements (verbatim, then resolved interpretation)

> 1. No real task execution that consume tokens should be done in both local
>    tests and CI/CD tests, we should use only tasks in --dry-run mode.
>    If we have such tests, we should mark them as integration tests and skip
>    by default, so we don't waste resources on each test run.
> 2. All tests should use Jest style or style similar to default of
>    <http://github.com/link-foundation/test-anywhere>, so we don't have single
>    file that lists of tests, that needs to be updated, we should use by
>    folder tests discovery.
> 3. `--isolated screen` should be used by default no usages of start-screen
>    anymore, in all places where start-screen is used, we should warn that
>    it is deprecated, and it is better use `--isolated screen`, that as I
>    remember is enabled by default.

Restated as actionable requirements:

| ID  | Requirement                                                                                                                                                               | Resolution surface                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Tests in the **default** suite must not spawn real `solve`/`hive` runs that consume tokens. Anything that does has to be tagged as integration and skipped unless opt-in. | `scripts/run-tests.mjs`, every `tests/test-*.mjs` file that shells out without `--dry-run`. Add a `default-skip` guard for integration markers.                                             |
| R2  | Discovery should be folder-based and require no manual list updates when a new test file lands.                                                                           | Replace the `LEGACY_DEFAULT_TESTS` array in `scripts/run-tests.mjs` with directory traversal + per-file marker. Default behaviour must include any new `tests/**/*.{test.mjs,test.js,mjs}`. |
| R3  | `--isolated screen` is already the default of the Telegram bot; the standalone `start-screen` binary is legacy and must surface a deprecation warning to the user.        | `src/start-screen.mjs` (CLI), `src/telegram-command-execution.lib.mjs` (programmatic invocation). Help text + first-line stderr.                                                            |
| R4  | Capture artefacts and analysis under `docs/case-studies/issue-1758/`.                                                                                                     | This document plus `data/` and `external/` subfolders.                                                                                                                                      |

## 3. Timeline (reconstructed)

| When (UTC of host)                | Event                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| 2026-05-05 21:08                  | Long-running detached screen `solve-link-assistant-hive-mind-539` created (legacy `start-screen`).  |
| 2026-05-06 07:23–07:26            | Two UUID screens spawned in close succession (`f77e704f-…`, `3003ba2b-…`). Likely from local tests. |
| 2026-05-06 08:10:11 / 08:20:35    | Two more UUID screens (`98ef35d4-…`, `161eb0ee-…`).                                                 |
| 2026-05-06 08:46:56               | Newest UUID screen `5311452a-…`.                                                                    |
| 2026-05-06 (same morning)         | Maintainer files issue #1758 with the screenshot, lists three requirements.                         |
| 2026-05-06 (later — branch start) | `issue-1758-bc8ede139a7b` cut from `main`; PR #1759 opened in DRAFT.                                |

Screenshot captured locally at
[`docs/case-studies/issue-1758/data/screenshot-screens.png`](data/screenshot-screens.png)
(downloaded via authenticated `gh` to avoid HTML 404 fallbacks).

## 4. Root cause analysis

### 4.1 Tests can leak real (token-consuming) work

- `scripts/run-tests.mjs` keeps an explicit `LEGACY_DEFAULT_TESTS` allow-list.
  Any new test file added under `tests/` is invisible until a maintainer edits
  the script. That tempted contributors to add ad-hoc test scripts that _do_
  invoke `solve`/`hive` for real (because nothing else gates them).
- There is no convention that prevents a test from omitting `--dry-run`. The
  only suite token in use is `@hive-mind-test-suite default|github-integration`,
  and the runner has no notion of "skip integration tests by default".
- Telegram and standalone screen sessions are launched by `start-screen` which
  intentionally keeps the screen alive (`exec bash`) so a developer can attach
  later. When tests exercised this path without `--auto-terminate`, the screen
  outlived the test run.

### 4.2 List-based discovery is brittle

The runner is configured by `LEGACY_DEFAULT_TESTS` (66 entries). When the list
drifts (new file added, file renamed) discovery silently misses tests. This
failure mode is invisible: CI happily reports a green run while a new test
file is never executed.

### 4.3 `start-screen` is no longer the recommended path

`src/telegram-bot.mjs` defaults `--isolation` to `screen` (see `cli option
'isolation' default: getenv('TELEGRAM_ISOLATION', 'screen')`), and the
isolation runner (`src/isolation-runner.lib.mjs`) drives screen sessions with
unique UUIDs and `$` (start-command) for status tracking. The `start-screen`
binary remains as a fallback when `--isolation` is disabled, but new code and
new tests should standardise on `--isolated screen`. Today there is **no**
warning emitted when someone calls `start-screen` directly or from
`telegram-command-execution.lib.mjs`, so the path is silently picked up by
copy-paste and shell history.

## 5. Solution plan (this PR)

### 5.1 Folder-based discovery (R2)

`scripts/run-tests.mjs`:

- Drop the hard-coded `LEGACY_DEFAULT_TESTS` array.
- The default suite includes every `tests/**/*.{test.mjs,test.js,mjs}` file
  _unless_ the file declares `@hive-mind-test-suite <other>` (e.g.
  `github-integration`, `integration`, `manual`).
- Files marked with `@hive-mind-integration` (new marker) are excluded from
  the default suite — opt-in via `--suite integration` or
  `HIVE_MIND_RUN_INTEGRATION=1`.

### 5.2 Integration / skip-by-default guard (R1)

- Introduce a single helper `tests/integration-guard.mjs` that exits with code
  0 (and prints "skipped — set HIVE_MIND_RUN_INTEGRATION=1 to enable") at the
  top of any test that requires real network / token spend.
- Move every test file that previously spawned non–dry-run `solve`/`hive`
  through that guard. (Audit pass: at the time of writing, the existing
  default suite is dry-run-only — see `tests/test-feedback-lines-integration.mjs`
  which is already on `github-integration`. The guard is therefore preventive,
  not retroactive.)

### 5.3 `start-screen` deprecation warning (R3)

- `src/start-screen.mjs` prints a single-line deprecation banner to stderr
  before any other action: `⚠️  start-screen is deprecated; prefer
--isolated screen (the default in newer hive/solve CLIs)`.
- The banner is suppressed when `HIVE_MIND_SUPPRESS_DEPRECATIONS=1` so CI
  output stays clean for the few intentional callers we still keep.
- `src/telegram-command-execution.lib.mjs::executeStartScreen` logs the same
  banner once per process, only the first time it is invoked, mirroring the
  Node deprecation idiom.

### 5.4 Documentation (R4)

This `README.md` plus `data/` (raw issue JSON, screenshot) and `external/`
(third-party links / research notes).

## 6. Existing components / libraries we can reuse

| Need                              | Existing piece                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Folder-based test discovery       | Already half-implemented in `scripts/run-tests.mjs::listMjsFiles()`. We just need to flip the default flow.                                                                     |
| Test runner that works everywhere | `test-anywhere` is in `devDependencies` and delegates to `node --test` / `bun test` / `deno test`. We keep `node --test`-friendly file names so future migration is mechanical. |
| Suite tagging                     | `@hive-mind-test-suite <name>` regex parser already implemented in `parseSuites()`. We extend it with `@hive-mind-integration`.                                                 |
| Process-once warnings             | Use a module-scope `let warned = false` flag; the codebase uses the same pattern in several lib files.                                                                          |

## 7. Verification plan

1. `node scripts/run-tests.mjs --suite default --list` lists the new
   discovery output; manually compare against the legacy list to confirm
   parity (no tests dropped silently).
2. `node scripts/run-tests.mjs --suite integration --list` shows tests that
   were previously hidden.
3. `./src/start-screen.mjs --help` prints both the deprecation banner and the
   help.
4. `HIVE_MIND_SUPPRESS_DEPRECATIONS=1 ./src/start-screen.mjs --help` only
   prints help.
5. New regression tests under `tests/`:
   - `test-issue-1758-runner-discovery.mjs` — folder-based discovery picks up
     a synthetic test file in a temp directory.
   - `test-issue-1758-start-screen-deprecation.mjs` — banner present /
     suppressible.

## 7.1. Orphan tests parked under `needs-triage`

Switching from a hard-coded list to folder-based discovery surfaced **16 test
files that were never in `LEGACY_DEFAULT_TESTS` and that fail when run today**.
None is a regression introduced by this PR — they are pre-existing silent
breakages. To preserve the previous user-facing behaviour ("`npm test` is
green") while keeping them discoverable, every one is marked
`@hive-mind-test-suite needs-triage`. Run them explicitly with:

```sh
node scripts/run-tests.mjs --suite needs-triage
```

Files parked:

- `tests/playwright-mcp-prompts.test.mjs`
- `tests/test-activity-timeout-1510.mjs`
- `tests/test-agent-budget-stats-1526.mjs`
- `tests/test-auto-init-repository.mjs`
- `tests/test-claude-revert-conflict.mjs`
- `tests/test-internal-server-error-retry.mjs`
- `tests/test-issue-1572-push-sync.mjs`
- `tests/test-issue-1600-comprehensive.mjs`
- `tests/test-issue-1600-log-fixtures.mjs`
- `tests/test-issue-1706-sub-session-size.mjs`
- `tests/test-merge-changesets-1452.mjs`
- `tests/test-opusplan-support.mjs`
- `tests/test-prompt-explore-sub-agent.mjs`
- `tests/test-request-timeout-retry.mjs`
- `tests/test-solution-summary.mjs`
- `tests/test-telegram-solve-queue.mjs`

Failure clusters observed (from a `--continue-on-failure` run):

- **External network / API**: real Telegram, GitHub gist, or HTTP requests
  time out or 401 in CI. These should adopt `skipUnlessIntegration()`.
- **Sandbox/git assumptions**: tests that `chdir` into temp git repos and rely
  on `/bin/sh` or specific git config. They need a portable shell spawn helper.
- **Stale imports / dead code**: e.g. `test-solution-summary.mjs` imports
  `checkForAiCreatedComments` which no longer exists.
- **Token-consuming / dry-run mode missing**: they invoke the real agent path.
  They should be migrated to use `--dry-run` or `skipUnlessIntegration()`.

A follow-up issue should triage each cluster and either fix or remove the
test. The point of this PR is to **expose** them — fixing 16 unrelated bugs
inside the same PR would defeat the bisect-friendly history we want to keep.

## 8. Upstream / external follow-ups

- `link-foundation/test-anywhere` — no change needed; we keep our files
  compatible with `node --test` discovery (`*.test.mjs`).
- `link-foundation/start` — no change needed; we already exercise `--isolated
screen` via `$` (start-command).

## 9. References

- Source issue: <https://github.com/link-assistant/hive-mind/issues/1758>
- Existing PR: <https://github.com/link-assistant/hive-mind/pull/1759>
- Related case studies: `docs/case-studies/issue-1545/` (isolation screen
  fallback), `docs/case-studies/issue-1700/` (isolation parsing), and
  `docs/case-studies/issue-1586/` (non-isolation screen timeout).
