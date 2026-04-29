---
'@link-assistant/hive-mind': patch
---

Fix flaky CI `test-suites` job caused by `use-m`'s no-retry global npm install
— issue #1724.

CI run [25109962685](https://github.com/link-assistant/hive-mind/actions/runs/25109962685/job/73581228475)
on `main` failed in the `test-suites` job at the third test file
(`tests/test-active-branch-runs-buffer-1722.mjs`) with:

```
Error: Failed to install command-stream@latest globally.
  [cause]: Error: Command failed: npm install -g command-stream-v-latest@npm:command-stream@latest
  npm error code ENOTEMPTY
  npm error path /opt/hostedtoolcache/node/24.14.1/x64/lib/node_modules/command-stream-v-latest/js/src/commands
```

Root cause: `src/github.lib.mjs` and `src/playwright-mcp.lib.mjs` call
`await use('command-stream')` at module top level (via `use-m`). Every test
file that transitively imports either module re-runs
`npm install -g command-stream-v-latest@npm:command-stream@latest`. `use-m`'s
`ensurePackageInstalled` issues a single `npm install -g` with no retry, and
npm intermittently fails with `ENOTEMPTY: directory not empty, rmdir` on
GitHub-hosted Ubuntu runners (a long-standing npm rmdir race against itself
when the previous global install left files behind).

Fix:

- New
  [`scripts/preinstall-use-m-packages.mjs`](./scripts/preinstall-use-m-packages.mjs)
  pre-installs every package the codebase loads through `use-m @latest`
  (`command-stream`, `getenv`, `links-notation`, `@dotenvx/dotenvx`,
  `telegraf`, `zx`, `yargs`) using the same alias scheme `use-m` does
  (`<pkg-without-@-or-/>-v-latest`), with exponential-backoff retry on the
  flake symptoms (`ENOTEMPTY` / `EBUSY` / `EPERM` / `ECONNRESET` / `ETIMEDOUT`
  / `EAI_AGAIN` / `429` / `503`). After this step, `use-m`'s
  `installedVersion === latestVersion` early-return path skips the install at
  test time, so test imports never touch `npm install -g` again.
- The script also satisfies the case-study "verbose mode for next iteration"
  requirement via `PREINSTALL_USE_M_VERBOSE=1` (or `RUNNER_DEBUG=1`), which
  logs each attempt's command, stdout, stderr, and backoff delay, and
  recognizes "package present on disk after a flake" as recovered success.
- Wires `node scripts/preinstall-use-m-packages.mjs` into the `test-suites`
  and `test-execution` jobs in
  [`.github/workflows/release.yml`](./.github/workflows/release.yml) right
  after `npm install`, before any step that runs test files or `solve.mjs`.

Tests:
[`tests/test-preinstall-use-m-packages-1724.mjs`](./tests/test-preinstall-use-m-packages-1724.mjs)
covers the alias scheme, retryable-error matcher, exponential backoff, and
the four `installWithRetry` paths (first-success, retry-then-succeed,
non-retryable-abort, recovered-from-disk) deterministically (no real npm
calls). Marked `@hive-mind-test-suite default` so it runs in the same job
that previously flaked.

Documentation:
[`docs/case-studies/issue-1724/`](./docs/case-studies/issue-1724/README.md)
contains the timeline, verbatim error, downloaded failed-run logs, the
no-retry snippet from the live `use-m` source
(`logs/use-m-source.js`), the comparison with both pipeline templates
(JS/Rust — neither template uses `use-m @latest` at module load yet, so the
flake is hive-mind-specific until they do), and the implementation plan.
