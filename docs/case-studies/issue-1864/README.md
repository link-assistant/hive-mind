# Issue 1864 Command-Stream Process Audit

## Summary

Issue [#1864](https://github.com/link-assistant/hive-mind/issues/1864) requested a full audit of native process execution and migration to [command-stream](https://github.com/link-foundation/command-stream) wherever the library can safely replace `child_process` or Bun shell usage.

The production audit found 36 files with native `child_process` imports before migration. The final audit leaves 20 documented exceptions, all tied to process lifecycle control, synchronous package/release/CI checks, argv-array `execFile` style execution, inherited TTY behavior, or known command-stream limitations.

## Requirements

- Read the GitHub issue, comments, existing PR state, local dependency research, npm package metadata, and upstream command-stream issue tracker.
- Save raw research data and audit logs under this case-study directory.
- Add an automated test that reproduces the audit problem before relying on implementation changes.
- Replace eligible native command execution with command-stream.
- Document remaining native-process exceptions and upstream blockers.
- Verify the fix with focused tests and the repository default test suite.

## Timeline

- 2026-06-08: Read issue #1864, PR #1865, and issue comments. The issue had no comments at the time of capture.
- 2026-06-08: Captured raw GitHub issue/PR data, npm metadata for `command-stream`, local `npm ls` output, upstream command-stream repository metadata, and upstream issue data.
- 2026-06-08: Generated the initial production scan in `audit/native-process-scan-production.txt`.
- 2026-06-08: Added `tests/test-issue-1864-command-stream-audit.mjs` to fail when new undocumented native `child_process` usage appears.
- 2026-06-08: Added `src/command-stream-exec.lib.mjs` as a compatibility adapter for old `exec` call sites that need `{ stdout, stderr }` and nonzero-exit errors.
- 2026-06-08: Migrated GitHub, status, screen-listing, invite, limit, git, and runtime probe command execution to the adapter.
- 2026-06-08: Added `tests/test-command-stream-exec-wrapper-1864.mjs` to verify the adapter captures output silently and throws exec-shaped errors.
- 2026-06-08: Generated final audit evidence after migration.

## Data Collected

Raw data:

- `raw-data/issue-1864.json`
- `raw-data/issue-1864-comments.json`
- `raw-data/pr-1865.json`
- `raw-data/command-stream-repo.json`
- `raw-data/command-stream-issues.json`
- `raw-data/command-stream-issue-136.json`
- `raw-data/npm-command-stream-view.json`
- `raw-data/npm-ls-command-stream.txt`
- `raw-data/npm-ls-use-m.txt`
- `raw-data/command-stream-api-probe.txt`

Audit evidence:

- Initial production scan: `audit/native-process-scan-production.txt`
- Final production scan: `audit/native-process-scan-final.txt`
- Initial native import scan: `audit/child-process-imports-production.txt`
- Final native import scan: `audit/child-process-imports-final.txt`
- Final command-stream migration scan: `audit/command-stream-migration-final.txt`
- Remaining exception table: `native-process-exceptions.md`

## Findings

The initial codebase still had plain native process execution in high-volume shell-command paths such as GitHub merge helpers, invitation handling, status probing, limit display, git identity checks, session monitoring, `start-screen`, and runtime discovery.

The root cause was not one single bug. The repository had accumulated several local `exec` wrappers with the same ergonomic shape as `child_process.exec`, while command-stream was already used elsewhere through `use-m`. That made new shell-command call sites easy to add through native process APIs even though command-stream was the preferred execution layer.

The fix centralizes the compatibility boundary in `src/command-stream-exec.lib.mjs`. Production modules that only need shell-command execution now use this adapter instead of importing `child_process.exec` or creating a local promisified wrapper.

## Migration

The new adapter:

- Lazily loads `command-stream` through the existing `use-m` pattern.
- Uses `{ mirror: false, capture: true }` to avoid leaking captured stdout into caller output.
- Preserves the old `{ stdout, stderr }` success shape.
- Throws an `Error` on nonzero exit with `code`, `cmd`, `stdout`, and `stderr`, matching what migrated retry/error code expects.
- Forwards `cwd`, `env`, and `input` where current migrated call sites rely on them.

Migrated areas include:

- GitHub rate-limit and retry command execution.
- Merge and CI GitHub helpers that shell out through `gh`.
- Invitation acceptance flows.
- Limit, git identity, screen status, session monitor, queue helper, top command, and start-screen probes.
- Runtime `which bun` / `which node` discovery.
- Recheck command execution through the existing GitHub retry wrapper.

## Remaining Native Exceptions

The remaining native process usage is intentionally documented in `native-process-exceptions.md` and enforced by `tests/test-issue-1864-command-stream-audit.mjs`.

The main exception groups are:

- Detached process lifecycle management with `spawn`.
- Inherited TTY or interactive stdin behavior.
- `spawn`/`execFile` argv-array execution with captured pipes and lifecycle callbacks.
- Synchronous release, install, cleanup, and CI scripts that intentionally drive process exit.
- Known command-stream gaps around git push, complex quoting, `gh pr create` output capture, timeout/signal support, and `execFile`/child-object semantics.

## Upstream Command-Stream Status

Existing upstream command-stream issues cover the gaps that blocked a complete migration, so no duplicate upstream issue was filed for this PR.

Relevant upstream issues include:

- [#136 Support .quite() function like in zx](https://github.com/link-foundation/command-stream/issues/136)
- [#50 CWD with CD pattern fails](https://github.com/link-foundation/command-stream/issues/50)
- [#49 Complex shell commands with nested quotes and variables fail](https://github.com/link-foundation/command-stream/issues/49)
- [#47 GitHub CLI PR create output not captured](https://github.com/link-foundation/command-stream/issues/47)
- [#46 Git push silent failure](https://github.com/link-foundation/command-stream/issues/46)
- [#45 Automatic quote addition in interpolation causes wrong output](https://github.com/link-foundation/command-stream/issues/45)
- [#43 Stream output handling issues](https://github.com/link-foundation/command-stream/issues/43)
- [#41 Paths with spaces need proper quoting](https://github.com/link-foundation/command-stream/issues/41)
- [#40 GitHub CLI with complex markdown body fails](https://github.com/link-foundation/command-stream/issues/40)
- [#23 Add a wrapper around spawnSync with advanced options](https://github.com/link-foundation/command-stream/issues/23)
- [#20 child object is not returned and child.kill is unavailable](https://github.com/link-foundation/command-stream/issues/20)
- [#19 real streams/stdin/stdout/stderr wrappers](https://github.com/link-foundation/command-stream/issues/19)
- [#15 Add signal support](https://github.com/link-foundation/command-stream/issues/15)

Local dependency research in `docs/dependencies-research/command-stream-issues/README.md` also records the same classes of limitations with reproducing scripts and workarounds.

## Verification

Focused checks run locally:

- `node tests/test-issue-1864-command-stream-audit.mjs`
- `node tests/test-command-stream-exec-wrapper-1864.mjs`
- `node tests/github-rate-limit.test.mjs`
- `node tests/test-execgh-transient-retry-1756.mjs`
- `node tests/test-git-identity.mjs`
- `node tests/limits-display.test.mjs`
- `node tests/telegram-show-limits.test.mjs`
- `node tests/test-hive-screens.mjs`
- `node tests/test-start-screen.mjs`
- `node tests/test-issue-1758-start-screen-deprecation.mjs`
- `node tests/test-issue-1680-session-monitoring.mjs`
- `node tests/test-issue-1670-screen-status-monitoring.mjs`
- `node tests/test-issue-1720-terminal-watch-no-log.mjs`
- `node tests/test-issue-1780-stop-by-url.mjs`
- `node tests/test-auto-accept-invite-1373.mjs`
- `node tests/test-accept-invites-output.mjs`
- `node tests/test-branch-ci-health-1425.mjs`
- `node tests/test-active-branch-runs-buffer-1722.mjs`
- `node tests/test-ready-to-merge-pagination-1645.mjs`
- `node tests/test-false-positive-workflow-run-race-1480.mjs`
- `node tests/test-cancelled-ci-rerun-1769.mjs`

Full local default suite:

- `npm test > ci-logs/local-npm-test.log 2>&1` - passed all 231 selected default test files.
- `npm run lint > ci-logs/local-npm-lint.log 2>&1` - passed.
- `npm run format:check > ci-logs/local-npm-format-check.log 2>&1` - passed.
