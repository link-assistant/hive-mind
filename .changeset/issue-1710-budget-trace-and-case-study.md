---
'@link-assistant/hive-mind': minor
---

Fix cost / token calculation correctness, unify Total / sub-session format,
add verbose budget trace, and case study for issue #1710

Resolves the four "strange things" the issue reported by changing both the
public-pricing math and the rendered output:

- **R1 — `$0.040000` residual eliminated.** `calculateModelCost`
  ([`src/claude.lib.mjs`](./src/claude.lib.mjs)) now bills Anthropic
  server-side tools. `web_search` is charged at the documented
  $10 / 1 000 requests rate (= $0.01 / req) via the new constants module
  [`src/anthropic-server-tool-pricing.lib.mjs`](./src/anthropic-server-tool-pricing.lib.mjs).
  For the issue's PR #1707 run that comes out to exactly the previously-shown
  $0.040000 / +0.16% delta, so the public-pricing total now reconciles with
  Anthropic's reported `total_cost_usd`. `accumulateModelUsage`
  ([`src/claude.budget-stats.lib.mjs`](./src/claude.budget-stats.lib.mjs))
  also picks up `usage.server_tool_use.web_search_requests` from JSONL.
- **R2 — Haiku sub-session line includes input information.** Sub-agent
  models never appear as the responding model in the parent JSONL, so
  `peakContextUsage` stays at `0`. The fallback in `buildBudgetStatsString`
  now emits the cumulative `(X new + Y cache writes [+ Z cache reads])`
  phrase instead of dropping the input information entirely.
- **R3/R5 — Sub-session and Total reconcile.** The bullet line is now
  labelled `peak request: …` so it cannot be confused with the cumulative
  Total line. `requestContext` (the source of `peakContextByModel`) excludes
  cache reads, so the bullet figure is `input + cache_creation` and is
  reconcilable with the cumulative non-cached total. Cache reads remain
  visible — and visible separately — on the Total line.
- **R4 — Total always splits cache reads / cache writes when present.**
  The conditional that previously keyed on `cacheReadTokens` only is replaced
  with a `buildCumulativeInputPhrase` helper that emits
  `(X new + W cache writes + Y cache reads) input tokens` when both kinds of
  cache activity exist, `(X new + W cache writes)` when only writes exist
  (the Haiku case that triggered the issue), and the back-compat
  `(X + Y cached)` form when only reads exist (so common Opus-only output
  is unchanged). Cache writes are billed at 1.25× / 2× of input — fusing
  them silently into the input figure was a real semantic bug, not a
  cosmetic one.

Both `displayBudgetStats` (solver-log renderer) and `buildBudgetStatsString`
(PR-comment renderer) share the helper, so the two paths render identically.

Also adds **`dumpBudgetTrace`**
([`src/claude.budget-stats.lib.mjs`](./src/claude.budget-stats.lib.mjs)),
a verbose-only structured per-model trace (peak request, cumulative
input/cache_write 5m+1h split/cache_read/output, server-tool counts with
implied dollar cost, public and Anthropic-reported costs, and the data
source) that fires from `displayBudgetStats` only when `{verbose: true}` is
set, so the default solver output is unchanged. The trace captures all the
inputs that drive the renderer in one place, so the next "calculation
correctness" report can be triaged from a saved log alone.

Tests:
- `tests/test-issue-1710-budget-trace.mjs` — 10 cases for the verbose trace.
- `tests/test-issue-1710-format-fixes.mjs` — 8 cases locking each requirement
  to numbers from `docs/case-studies/issue-1710/facts.md` (the actual
  PR #1707 result event the issue quotes).

Documentation: `docs/case-studies/issue-1710/` contains the root-cause
analysis (per symptom, with file:line citations), the captured facts, and
the (now-implemented) solution plans.

Also fixes the hosted-CI flake that surfaced while validating this PR:
`use-m` occasionally hands back a truncated/corrupt global package after
`npm install -g`, surfacing as either
`Failed to import module from '...': SyntaxError: Unexpected end of input`
or `Failed to resolve the path to '<pkg>'` when use-m loads `getenv` /
`links-notation` from `src/config.lib.mjs` and `src/lino.lib.mjs`. Adds
`src/use-with-retry.lib.mjs`, a small wrapper around `use(...)` that
recognises both flake modes, removes the broken alias directory, and
re-fetches once. Covered by `tests/test-use-with-retry.mjs` (13 cases).
