# Issue #2113 — incomplete dependency installs and cleanup races

On 2026-07-28, `fix --ci-cd` stopped while creating a remediation issue because
the globally installed `command-stream-v-latest` alias contained `src/$.mjs`
but not the file that entry point imports, `src/terminal-capture.mjs`.
A second run failed on another packaged file, `src/$.trace.mjs`. Both files are
present in the published `command-stream@0.17.2` tarball, establishing that the
global alias was incomplete rather than the package release.

The recovery introduced for issues #1710, #1712, and #2092 was already applied
at the shared `ensureUseM()` bootstrap, so every relevant dependency load used
it. The remaining gap was classification: `ERR_MODULE_NOT_FOUND` nested under
use-m's `Failed to import module from ...` wrapper was not recognized as an
incomplete install. It therefore failed immediately without cleanup or retry.

`use-m@8.14.3` then shipped upstream self-healing, but the next supplied run
exposed a second gap: recursive alias removal failed with `ENOTEMPTY`.
`fsPromises.rm()` retries that code only when `maxRetries` is explicitly
positive; use-m and Hive Mind both used the zero-retry default.

This change covers both exact signatures. The shared loader recognizes wrapped
internal `ERR_MODULE_NOT_FOUND` and retryable use-m alias-cleanup failures,
removes the whole versioned alias with a bounded retry budget, and retries the
dependency load for every existing and future `use(...)` call site.

## Contents

- [`timeline.md`](timeline.md) reconstructs the observed sequence and prior fixes.
- [`requirements.md`](requirements.md) maps every issue requirement to evidence.
- [`analysis.md`](analysis.md) documents root cause, scope, alternatives, and plan.
- [`research.md`](research.md) records upstream and platform research.
- [`raw/`](raw/) preserves all three supplied logs and the package/release audit.
- [`upstream-use-m-cleanup-report.md`](upstream-use-m-cleanup-report.md) preserves
  the report filed as [use-m #68](https://github.com/link-foundation/use-m/issues/68).
- [`../../../../experiments/issue-2113/reproduce-missing-transitive.mjs`](../../../../experiments/issue-2113/reproduce-missing-transitive.mjs)
  is a hermetic missing-file reproduction.
- [`../../../../experiments/issue-2113/reproduce-cleanup-race.mjs`](../../../../experiments/issue-2113/reproduce-cleanup-race.mjs)
  reproduces `ENOTEMPTY` and verifies retry-budget cleanup.

## Verification

```bash
node experiments/issue-2113/reproduce-missing-transitive.mjs
node experiments/issue-2113/reproduce-cleanup-race.mjs
node tests/test-use-with-retry.mjs
```
