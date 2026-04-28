---
'@link-assistant/hive-mind': patch
---

Add `dumpBudgetTrace` verbose-only diagnostic, case study, and use-m corrupt-install retry for issue #1710

Adds a structured per-model trace (peak request, cumulative input/cache_write
5m+1h split/cache_read/output, server-tool counts, and both public and
Anthropic-reported costs) that fires from `displayBudgetStats` only when
`{verbose: true}` is set, so the default solver output is unchanged. The trace
captures all the inputs that drive the renderer in one place, so the next
"calculation correctness" report can be triaged from a saved log alone.
Also documents — in `docs/case-studies/issue-1710` — the root cause of every
"strange thing" the issue lists: the public-pricing estimator does not bill
`webSearchRequests` (4 × $0.01 = the reported $0.04 residual), Haiku's
sub-agent rendering drops the input phrase because `peakContextUsage` stays
at 0 for sub-agent traffic, and the sub-session "X tokens" vs Total "(Y + Z
cached)" lines describe different metrics (peak per request vs. cumulative
across the run). Tests in `tests/test-issue-1710-budget-trace.mjs`.

Also fixes the hosted-CI flake that surfaced while validating this PR:
`use-m` occasionally hands back a truncated/corrupt global package after
`npm install -g`, surfacing as either
`Failed to import module from '...': SyntaxError: Unexpected end of input`
or `Failed to resolve the path to '<pkg>'` when use-m loads `getenv` /
`links-notation` from `src/config.lib.mjs` and `src/lino.lib.mjs`. Adds
`src/use-with-retry.lib.mjs`, a small wrapper around `use(...)` that
recognises both flake modes, removes the broken alias directory, and
re-fetches once. Covered by `tests/test-use-with-retry.mjs` (13 cases).
