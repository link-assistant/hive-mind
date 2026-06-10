# Case study — Issue #1886: "Calculation of cost has difference"

- Issue: <https://github.com/link-assistant/hive-mind/issues/1886>
- Observed in: <https://github.com/link-assistant/formal-ai/pull/396#issuecomment-4672854592>
- Source log (gist): <https://gist.githubusercontent.com/konard/4c233f1134b97d5ca4b20482743a85fb/raw/1e72d523a79073c2c81e7bdfe4089dd7a0baf2c8/solution-draft-log-pr-1781113643393.txt>
- Fix PR: <https://github.com/link-assistant/hive-mind/pull/1889>

## Summary

A working-session log reported a cost discrepancy in its final summary:

```
   💰 Cost estimation:
      Public pricing estimate: $36.085016
      Calculated by Anthropic: $24.662220
      Difference:              $-11.422796 (-31.66%)
```

The instinct is "the per-token pricing math is wrong." **It is not.** Both numbers
are individually correct — they simply cover **different scopes**:

- **"Public pricing estimate" ($36.085016)** is computed from the session JSONL
  file, which accumulates the **entire** session across every limit-reset resume.
- **"Calculated by Anthropic" ($24.662220)** comes from the stream-json `result`
  event's `total_cost_usd`, which is scoped to a **single Claude process** — only
  the last (resumed) run.

This session hit the Anthropic usage limit during the first run, was auto-resumed
into a second process ~2.5 hours later, and the second process's `result` event
naturally only knew about its own cost. The summary then compared a **full-session
estimate** against a **single-process Anthropic figure**, producing the misleading
`-31.66%`.

The fix accumulates Anthropic's per-process `total_cost_usd` across resume
iterations so the displayed Anthropic figure shares the same full-session scope as
the public estimate. The accumulation is **model-agnostic** — it sums dollar
amounts and never inspects per-token prices, so it is correct for all models.

## Timeline (reconstructed from the gist log)

All times UTC, 2026-06-10. Session id: `160da4c5-d2f8-4488-873e-5936eacfac37`.
Raw excerpts are preserved under [`data/`](./data).

| Time     | Event                                                                                                                                                                                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 14:08:21 | **Run 1** starts — original `solve` process for formal-ai issue #395 / PR #396. Writes to session JSONL `160da4c5…jsonl`.                                                                                                                                       |
| 14:43:41 | **Usage limit reached.** Run 1 is interrupted (ends as `is_error` — no `success` result event). Comment "⏳ Usage Limit Reached" posted.                                                                                                                        |
| 17:03:10 | **Auto Resume (on limit reset).** `autoContinueWhenLimitResets` spawns **Run 2**: `solve … --resume 160da4c5… --auto-resume-on-limit-reset --auto-resume-iteration 1 --session-type auto-resume` (a fresh node process).                                        |
| 17:03:20 | Run 2's Claude process starts with `claude --resume 160da4c5…`. It **appends** to the same JSONL, which already holds Run 1's turns.                                                                                                                            |
| 17:45:44 | Run 2's context auto-compacts ("This session is being continued from a previous conversation…").                                                                                                                                                                |
| 17:47:07 | Run 2 emits its `success` `result` event: `total_cost_usd: 24.662219…`, `modelUsage.claude-fable-5` = 31 490 / 137 297 / 13 211 220 / 341 700 (in/out/cache-read/cache-write). Captured: `💰 Anthropic official cost captured from success result: $24.662220`. |
| 17:47:12 | Final **Token Usage Summary** computed from the **full JSONL**: 45 265 / 185 995 / 16 444 028 / 791 087 → **$36.085016**. Cost comparison prints the `-31.66%` difference.                                                                                      |

The key structural fact: **Run 1 and Run 2 are separate OS processes that share one
JSONL file.** The JSONL is cumulative; the `result` event is per-process.

## Reproducing the discrepancy

The exact numbers reproduce from the real token counts (see
[`../../../experiments/issue-1886-costcheck.mjs`](../../../experiments/issue-1886-costcheck.mjs)
and [`../../../tests/test-issue-1886-cost-accumulation.mjs`](../../../tests/test-issue-1886-cost-accumulation.mjs)):

```bash
node experiments/issue-1886-costcheck.mjs
# result-event scope cost (should ~= 24.662220): 24.662220
# full-session scope cost (should ~= 36.085016): 36.085015
# reported difference -31.66% reproduced: -31.66%
# run1 folded from non-success fallback (should ~= 11.42): 11.422795
# cumulative anthropic after resume: 36.085015 -> matches full estimate: true
```

Fable 5 pricing (per million tokens, from models.dev): input $10, cache-write
$12.5, cache-read $1, output $50.

| Scope                             | input  | cache-write | cache-read | output  | × prices = cost |
| --------------------------------- | ------ | ----------- | ---------- | ------- | --------------- |
| Run 2 (result-event `modelUsage`) | 31 490 | 341 700     | 13 211 220 | 137 297 | **$24.662220**  |
| Full session (JSONL summary)      | 45 265 | 791 087     | 16 444 028 | 185 995 | **$36.085016**  |
| Run 1 (difference)                | 13 775 | 449 387     | 3 232 808  | 48 698  | **~$11.422796** |

`(24.662220 − 36.085016) / 36.085016 × 100 = −31.66%` — the reported gap, exactly.
This proves the per-token math is correct and the gap is purely a **scope mismatch**.

## Requirements (from the issue body)

1. **Find the root cause of the cost-calculation difference and fix it for all models.**
2. **Double-check the logs; make sure all usage tokens are properly calculated.**
3. **Download all related logs/data into `docs/case-studies/issue-1886`.**
4. **Deep case study analysis** (incl. online search): reconstruct timeline, list every
   requirement, find root causes per problem, propose solutions/plans, and check
   known existing components/libraries that solve similar problems.
5. **If data is insufficient for the root cause, add debug output / verbose mode** for
   the next iteration.
6. **If the issue is related to another repository, report it** with reproducible
   examples, workarounds, and code-fix suggestions.
7. **Apply the fix in all places** in the codebase where the issue exists.
8. **Plan and execute everything in a single PR** (#1889).

## Root cause analysis

### Primary root cause — scope mismatch (proven)

`displayCostComparison` (in `src/claude.budget-stats.lib.mjs`) compares:

- `publicCost` — `calculateModelCost(usage, modelInfo)` over the **full session JSONL**
  (the JSONL accumulates every resume iteration; limit-reset resumes append to the
  same `<session-id>.jsonl`), and
- `anthropicCost` — the `result` event's `total_cost_usd`, **scoped to one Claude
  process** (`src/claude.lib.mjs`, captured at the `subtype === 'success'` branch).

When a session spans more than one process (limit-reset resume, fallback-model
switch, etc.), these scopes diverge and the comparison is apples-to-oranges. The
per-token cost function `calculateModelCost` was audited and is **correct** — it
multiplies input/cache-write/cache-read/output tokens by the model's per-million
prices using `decimal.js-light`, plus web-search per-request. No pricing bug exists.

### Secondary root cause — limit-hit cost was discarded

The Anthropic cost was only captured from a `result` event with
`subtype === 'success'`. A usage-limit hit (Run 1) ends as `is_error`, so **its
`total_cost_usd` was explicitly ignored** (the old code logged
`💰 Anthropic cost from … result ignored`). That meant Run 1's ~$11.42 could never
be folded into a cumulative total even in principle — so accumulation alone would
still have under-counted the very scenario in the report.

### External corroboration

This is a known, documented property of the Claude Code Agent SDK, not a
hive-mind-specific miscalculation:

- The official **"Track cost and usage"** docs state each `query()` call returns its
  own `total_cost_usd` and _"The SDK does not provide a session-level total… you
  need to accumulate the totals yourself"_
  (<https://platform.claude.com/docs/en/agent-sdk/cost-tracking>).
- Upstream bug **anthropics/claude-code#13088** — _"`/cost` Command Resets on Session
  Resume"_ — describes exactly this: after resuming a session, `/cost` shows only the
  cost since resume, not the cumulative cost from the beginning
  (<https://github.com/anthropics/claude-code/issues/13088>).

Because the upstream SDK deliberately scopes cost per-process and leaves
session-level aggregation to the caller, the correct place to fix this is **in
hive-mind** (the caller), which is what this PR does. No new upstream issue is
warranted — #13088 already tracks the SDK-side behavior, and this PR links to it.

## The fix

### 1. A centralized cumulative-cost accumulator

`src/anthropic-cost-accumulator.lib.mjs` (new) holds a module-level running total
per node process:

- `seedCumulativeAnthropicCost(previousAnthropicCostUSD)` — seeds the total **once**
  per process from the carried-forward value (idempotent, so the in-process
  auto-merge / keep-working loop can call it repeatedly without double-seeding).
- `addAnthropicRunCost(runCostUSD)` — folds one finished process's cost into the
  total (non-positive / non-finite values add nothing). Returns the cumulative.
- `getCumulativeAnthropicCost()`, `hasCumulativeAnthropicCost()`,
  `resetCumulativeAnthropicCost()` (test helper).

Summing dollar amounts makes it **model-agnostic** — it satisfies "fix it for all
models" without ever touching per-token prices.

### 2. Thread the cumulative total across the cross-process resume

- `src/solve.config.lib.mjs` — adds a hidden `--previous-anthropic-cost` option.
- `src/claude.lib.mjs` — on every terminal path (success **and** all failure paths:
  limit hit, stuck-retry, retries-exhausted, exception) it seeds from
  `argv.previousAnthropicCost`, folds this process's cost, and returns the
  **cumulative** total as `anthropicTotalCostUSD`.
- `src/solve.auto-continue.lib.mjs` — `autoContinueWhenLimitResets` reads the
  cumulative total and passes `--previous-anthropic-cost <total>` to the resumed
  `solve` process, so Run 2 continues Run 1's running total.

Because `runClaude` now returns the cumulative value, the **in-process** auto-merge
/ watch / keep-working loops in `solve.mjs` pick it up automatically
(`latestAnthropicCost = toolResult.anthropicTotalCostUSD`) — no extra `+=` needed.

### 3. Capture the limit-hit cost (secondary root cause)

`src/claude.lib.mjs` now keeps the `total_cost_usd` from a **non-success** terminal
`result` event as a fallback (`anthropicCostFromAnyResult`) and folds
`successCost ?? nonSuccessResultCost` on the failure paths. This lets Run 1's
~$11.42 be carried into Run 2, fully closing the gap in the reported scenario.

### 4. Scope-aware diagnostics (so the number is never mysterious again)

`displayCostComparison` / `displaySessionTokenUsage` now accept
`previousAnthropicCost`. When a carried-forward cost is present, verbose mode prints
an explicit breakdown:

```
   ↳ Anthropic cost is cumulative across resume iterations (issue #1886):
     this run: $24.662220 + carried forward: $11.422796 = $36.085016
```

If a future scenario still can't capture an earlier process's cost (e.g. the SDK
emits no cost at all on a hard limit), this breakdown makes the residual scope
difference visible instead of surfacing a bare misleading percentage.

## Verification

- `node experiments/issue-1886-costcheck.mjs` — reproduces $24.662220 / $36.085016 /
  −31.66% and shows accumulation closing the gap to the full-session estimate.
- `node tests/test-issue-1886-cost-accumulation.mjs` — 12 tests covering the
  reproduction, the accumulator (idempotent seed, accumulation, input sanitization),
  the non-success fallback, and the display breakdown.
- `node tests/test-display-cost-comparison.mjs` — existing display tests still pass.
- `node scripts/run-tests.mjs --suite default` — all 237 default test files pass.
- `npm run lint` — clean.

## Solution alternatives considered

| Option                                                                                                             | Verdict                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Compute the public estimate over the per-process `modelUsage` scope (shrink the public number to match Anthropic). | Rejected — it would hide the true full-session cost, which is the number users actually care about.                                         |
| Accumulate Anthropic `total_cost_usd` across resume iterations (chosen).                                           | Adopted — both numbers end up at full-session scope; model-agnostic; matches the official SDK guidance to "accumulate the totals yourself". |
| Drop the Anthropic figure entirely on resumed sessions.                                                            | Rejected — loses Anthropic's authoritative cost and the useful public-vs-actual comparison.                                                 |

## Existing components / libraries checked

- **Anthropic Claude Code Agent SDK cost-tracking guidance** — the canonical pattern
  is exactly "accumulate `total_cost_usd` yourself across `query()` calls"; this PR
  implements that pattern (<https://platform.claude.com/docs/en/agent-sdk/cost-tracking>).
- **`decimal.js-light`** — already used by `src/claude.cost.lib.mjs` for precise
  per-token math; reused, unchanged.
- **In-repo precedent** — `src/claude.cost.lib.mjs` / `src/claude.budget-stats.lib.mjs`
  already centralize cost computation/rendering (Issues #1557, #1703, #1834); the new
  accumulator follows the same single-responsibility, well-tested module convention.

## Sources

- Anthropic — Track cost and usage (Agent SDK): <https://platform.claude.com/docs/en/agent-sdk/cost-tracking>
- anthropics/claude-code#13088 — `/cost` resets on session resume: <https://github.com/anthropics/claude-code/issues/13088>
- Original observation: <https://github.com/link-assistant/formal-ai/pull/396#issuecomment-4672854592>
- Full session log: <https://gist.github.com/konard/4c233f1134b97d5ca4b20482743a85fb>
