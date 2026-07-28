# Issue #2113 — an incomplete dependency tree escaped the shared retry

On 2026-07-28, `fix --ci-cd` stopped while creating a remediation issue because
the globally installed `command-stream-v-latest` alias contained `src/$.mjs`
but not the file that entry point imports, `src/terminal-capture.mjs`.

The recovery introduced for issues #1710, #1712, and #2092 was already applied
at the shared `ensureUseM()` bootstrap, so every relevant dependency load used
it. The remaining gap was classification: `ERR_MODULE_NOT_FOUND` nested under
use-m's `Failed to import module from ...` wrapper was not recognized as an
incomplete install. It therefore failed immediately without cleanup or retry.

This change adds that exact, narrowly-scoped classification. The shared loader
now removes the whole versioned alias directory and retries, covering every
existing and future `use(...)` call site.

## Contents

- [`timeline.md`](timeline.md) reconstructs the observed sequence and prior fixes.
- [`requirements.md`](requirements.md) maps every issue requirement to evidence.
- [`analysis.md`](analysis.md) documents root cause, scope, alternatives, and plan.
- [`research.md`](research.md) records upstream and platform research.
- [`raw/start-command.log`](raw/start-command.log) preserves the supplied log.
- [`../../../../experiments/issue-2113/reproduce-missing-transitive.mjs`](../../../../experiments/issue-2113/reproduce-missing-transitive.mjs)
  is a hermetic reproduction.

## Verification

```bash
node experiments/issue-2113/reproduce-missing-transitive.mjs
node tests/test-use-with-retry.mjs
```
