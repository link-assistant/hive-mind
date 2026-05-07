---
'@link-assistant/hive-mind': minor
---

Switch the test runner to folder-based discovery and deprecate `start-screen` in favour of `--isolated screen` (issue #1758).

- `scripts/run-tests.mjs` now discovers every `*.mjs` / `*.test.mjs` / `*.test.js` file under `tests/` automatically. The hard-coded `LEGACY_DEFAULT_TESTS` allow-list is gone, so new test files no longer need a runner update to be picked up.
- New markers complement the existing `@hive-mind-test-suite <name>` marker:
  - `@hive-mind-integration` — skip the file in the default suite; opt in via `--suite integration` or `HIVE_MIND_RUN_INTEGRATION=1`.
  - `@hive-mind-test-skip` — exclude helper / fixture modules from every suite.
- `tests/integration-guard.mjs` exposes `skipUnlessIntegration(import.meta.url)` for token- or network-heavy tests.
- `src/start-screen.mjs` and `src/telegram-command-execution.lib.mjs::executeStartScreen` print a one-shot deprecation banner to stderr (suppressible with `HIVE_MIND_SUPPRESS_DEPRECATIONS=1`) recommending `--isolated screen`, which is already the default for `hive`/`solve` invocations through the Telegram bot.
- Adds regression tests `tests/test-issue-1758-runner-discovery.mjs`, `tests/test-issue-1758-start-screen-deprecation.mjs`, and `tests/test-issue-1758-integration-guard.mjs`.
- Documents the analysis under `docs/case-studies/issue-1758/`.
