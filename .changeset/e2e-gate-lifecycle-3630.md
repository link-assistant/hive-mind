---
'@link-assistant/hive-mind': patch
---

Real GitHub E2E tasks now have explicit custody and are always finalized (#3630). Every task issue and pull request records its owning workflow, run, attempt, task and source. An `always()` finalize step closes them on success, failure or cancellation, with a comment naming the run and the outcome. The cleanup sweep finalizes leftovers only when custody is proven and the owning run has finished, and it can also sweep consumer repositories such as formal-ai.

The real E2E gate now runs only after every other pull request check passes. A recorded pass is reused within the pull request, and its source identity is kept. Retries apply only to failed rows, with a bound per source. Each merged source runs exactly once. Fixture creation is locked, so repeated events cannot duplicate tasks.

Every attempt records its commands, identities, delivery and a manifest that marks missing and truncated data. Recorded runs become redacted, deterministic replays, which the production row runner and oracles judge against a GitHub emulator; a tripwire proves that no real task is created.
