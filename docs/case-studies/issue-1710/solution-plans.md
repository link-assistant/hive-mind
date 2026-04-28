# Issue #1710 — Solution plans (per requirement)

> Each plan lists: scope of change, file(s), suggested code shape, tests to
> add or extend, and risks / open questions. Numbers below cite the _current_
> file:line locations on `main`/`issue-1710-16bcd58d1d40` at the time of this
> case study (commit hashes from `data/issue-1710.json`).

---

## R1 — Cost difference must be either zero or itemised

**Goal.** Either eliminate the residual `$0.04 (+0.16 %)` line for runs that
contain server-side tool usage, or itemise the residual so the reader sees
_why_ it exists.

**Recommended plan: itemise + reuse Anthropic's value as the source of truth.**

1. Extend the model-info shape used by `calculateModelCost`
   ([`src/claude.lib.mjs:390-438`](../../../src/claude.lib.mjs))
   to accept a `serverTools` map, e.g.

   ```js
   modelInfo.serverTools = {
     web_search: { costPerRequest: 0.01 }, // $10 / 1k = $0.01
     // future: code_execution, web_fetch (currently $0), etc.
   };
   ```

   When `usage.webSearchRequests > 0`, add
   `usage.webSearchRequests * costPerRequest` to the breakdown as a fifth
   category and to the running total.

2. Source the per-request price either from the existing model-info package
   (preferred, so it stays version-pinned with the rest of `data/`) or from
   a small constants file
   `src/anthropic-server-tool-pricing.lib.mjs` exporting

   ```js
   export const SERVER_TOOL_PRICING_USD = {
     web_search: { costPerRequest: 0.01, source: 'https://platform.claude.com/docs/en/about-claude/pricing#web-search-tool' },
     web_fetch: { costPerRequest: 0 },
   };
   ```

3. In
   [`src/github-cost-info.lib.mjs:65-72`](../../../src/github-cost-info.lib.mjs)
   and
   [`src/claude.budget-stats.lib.mjs:127-148`](../../../src/claude.budget-stats.lib.mjs),
   when the breakdown contains `webSearch` items, render an extra bullet:

   ```
   - Public pricing estimate: $25.677806
     • Tokens:               $25.637806
     • Web search (4 × $0.01): $0.040000
   - Calculated by Anthropic:  $25.677806
   ```

   With this in place, "Difference" will round to zero for the original PR
   #1707 run and the existing #1703 short-form collapse will engage.

**Tests.**

- Extend `tests/test-build-cost-info-string.mjs` with a fixture using the
  exact numbers from [`facts.md`](./facts.md). Assert that the residual is
  zero and the short form is emitted.
- Add a unit test on `calculateModelCost` covering `webSearchRequests`.

**Risk.** Anthropic might change web-search pricing. Mitigation: keep the
constant in a single file with a doc-link comment; bumping it is one line.

---

## R2 — Haiku sub-session must include input-tokens information

**Goal.** Render an input-tokens phrase even when `peakContextUsage === 0`.

**Plan.**

1. In
   [`src/claude.budget-stats.lib.mjs:454-465`](../../../src/claude.budget-stats.lib.mjs),
   replace the output-only fallback with a new helper that emits the
   _cumulative_ `(X + Y cached)` form on the bullet line, omitting the
   percentage (we have no per-request peak):

   ```js
   } else if (outputLimit && callCount <= 1) {
     const totalInputNonCached = usage.inputTokens + usage.cacheCreationTokens;
     const cachedTokens = usage.cacheReadTokens;
     const inputPhrase = cachedTokens > 0
       ? `(${formatTokensCompact(totalInputNonCached)} + ${formatTokensCompact(cachedTokens)} cached) input tokens`
       : `${formatTokensCompact(totalInputNonCached)} input tokens`;
     const outPct = ((usage.outputTokens / outputLimit) * 100).toFixed(0);
     stats += `\n- ${inputPhrase}, ${formatTokensCompact(usage.outputTokens)} / ${formatTokensCompact(outputLimit)} (${outPct}%) output tokens`;
   }
   ```

2. The corresponding solver-log path
   ([`displayBudgetStats`, claude.budget-stats.lib.mjs:159-225](../../../src/claude.budget-stats.lib.mjs))
   already prints the Total line, so no separate change is needed there;
   only the PR-comment renderer needs the fallback.

**Tests.**

- Extend `tests/test-issue-1600-budget-stats.mjs` test
  _"single sub-agent session shows output detalization when no peak context"_
  to also assert the new input phrase appears.

**Open question.** Should we also use the data from
`subAgentCallsByToolUseId` (`claude.lib.mjs:990-991`) to compute a
per-call peak across sub-agent calls? It would give Haiku a real
percentage. This is a separate enhancement — track as a follow-up.

---

## R3 — Sub-session and Total numbers must reconcile (or be labelled)

**Goal.** Make `278.2K` reconcile arithmetically with `342.2K + 42.7M`, or
label the two so a reader can tell they describe different metrics.

**Plan A — labels (recommended, low-risk).**

1. Rename the bullet phrase from
   `"X / Y (Z%) input tokens"` to
   `"peak request: X / Y (Z%) input tokens"` in
   [`formatContextOutputLine`](../../../src/claude.budget-stats.lib.mjs)
   (line 327-339). For sub-sessions in
   `formatSubSessionsList` (308-316), use
   `"peak: X / Y (Z%)"` to keep numbered items short.
2. Rename Total to `"Cumulative: …"` in
   `displayBudgetStats` (line 224) and
   `buildBudgetStatsString` (line 539).
3. Add a one-line legend after the section header:

   > "Peak = largest single request; Cumulative = sum across the run."

**Plan B — change the metric (numbers reconcile, but lose %).**
Drop cache reads from `requestContext` so the bullet figure equals
`Σ(input + cache_creation)` for one request. Then the bullet is
`peak ≤ totalInputNonCached`, which is intuitively reconcilable.
Downside: the bullet "% of context window" no longer reflects the actual
fill (cache reads _do_ occupy the window) and so misleads about how close
to the limit a request was.

**Recommendation.** Ship Plan A first — it is a comment-text change with no
arithmetic risk. Plan B can be re-evaluated after Plan A lands if users still
report confusion.

**Tests.** Snapshot the rendered output for the three canonical fixtures
(Opus only, Opus + Haiku sub-agent, Sonnet+Haiku) in
`tests/test-issue-1600-budget-stats.mjs`.

---

## R4 — Total must always show cached vs. non-cached separately

**Goal.** The `(X + Y cached)` form must appear whenever any cache activity
occurs (reads OR writes), and the underlying numbers must not silently merge
two billing categories.

**Plan.**

1. Change the conditional in
   [`src/claude.budget-stats.lib.mjs:471`](../../../src/claude.budget-stats.lib.mjs)
   from `if (cachedTokens > 0)` to:

   ```js
   const hasCacheActivity = (usage.cacheReadTokens || 0) > 0 || (usage.cacheCreationTokens || 0) > 0 || (usage.cacheCreation5mTokens || 0) > 0 || (usage.cacheCreation1hTokens || 0) > 0;
   ```

2. Switch the displayed phrase to a three-component form when writes exist:

   ```
   Total: (X new + W cache writes + Y cache reads) input tokens, ...
   ```

   When `W = 0` we collapse to `(X + Y cached)`, when `Y = 0` and `W > 0` we
   render `(X new + W cache writes)`. This avoids losing information when
   only writes happened (the Haiku case in this run).

3. Apply the _same_ logic in
   [`displayBudgetStats`, lines 210-217](../../../src/claude.budget-stats.lib.mjs)
   for the solver-log renderer.

**Tests.**

- New fixture in `tests/test-issue-1600-budget-stats.mjs` using the Haiku
  numbers from [`facts.md`](./facts.md): assert the rendered Total contains
  `77 969` _and_ `57 580` separately.
- Existing tests in `tests/test-issue-1600-budget-stats.mjs` that check
  `(X + Y cached)` continue to pass — the new branch is a superset.

**Risk.** Some downstream consumers (Telegram top command, log scrapers)
may parse the Total line. A repo-wide grep
(`rg "input tokens" -t mjs`) shows only renderers; no parser. Safe.

---

## R5 — Normative rule: sub-sessions exclude cache, totals split cache

**Goal.** Encode the user's normative rule.

**Plan.**

1. Change the `requestContext` definition in
   [`src/claude.lib.mjs:501`](../../../src/claude.lib.mjs) to drop cache
   reads:

   ```js
   const requestContext = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
   ```

2. Pair this with R3 Plan A's label change so the bullet reads
   `peak request (excl. cache reads): N / contextLimit`.
   Without that label the new metric will be confusing to anyone who saw
   the old one.

**Backward-compat note.** The `peakContextUsage` value is also surfaced in
the verbose log (`📊 Peak single-request context: X tokens`). That message
should be renamed in the same commit
(`📊 Peak single-request input (excl. cache reads): X tokens`).

**Tests.** Add a fixture asserting that a request with
`{input:1, cache_creation:270, cache_read:277_947}` produces a
`peakContextUsage` of `271`, not `278_218`.

---

## R6 — Compile case study

✅ This folder. No further code change.

---

## R7 — Add debug / verbose mode for next iteration

**Goal.** Make sure that the next time someone reports a calculation
oddity, all the numbers needed to root-cause it are already in the run log.

**Plan — single new helper, opt-in via existing `--verbose`.**

1. Add a `dumpBudgetTrace(usage, tokenUsage, log)` helper in
   `src/claude.budget-stats.lib.mjs` that emits, **per model**, behind
   `verbose: true`:

   ```
   📊 [budget-trace] claude-opus-4-7
        peak request:    278218 = input  + cache_create  + cache_read
                                     1     +      270     +    277947     (req# 217)
        cumulative:      input  690, cache_write 341517 (5m 0 / 1h 341517),
                         cache_read 42679751, output 79567,
                         web_search 0, total 43101525
        cost components: token $25.466982, server-tool $0.000000
        source:          jsonl + result-event
   ```

2. Call it from
   [`displayBudgetStats`](../../../src/claude.budget-stats.lib.mjs) right
   after the existing `📊 Context and tokens usage:` block, gated by
   `argv.verbose`/`log({verbose:true})` (already plumbed through).

3. Also dump per-call sub-agent stats from `subAgentCallsByToolUseId` when
   non-empty, so the next investigator can see Haiku's per-call cache
   activity without re-parsing the gist.

**Tests.** Snapshot the trace shape for the canonical fixture.

---

## R8 — Upstream issues

See [`upstream.md`](./upstream.md). Both proposed reports include a
minimal reproducer and a precise ask, per the issue's request.

---

## Appendix — components / libraries already in the repo we should reuse

| Need                              | Existing helper                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Decimal arithmetic                | `decimal.js-light` (`github-cost-info.lib.mjs:3`, `claude.budget-stats.lib.mjs:6`)                                |
| Compact `K` / `M` token formatter | `formatTokensCompact` (`claude.budget-stats.lib.mjs:291`)                                                         |
| Per-model usage merging           | `mergeResultModelUsage` (`claude.budget-stats.lib.mjs:234`)                                                       |
| Sub-agent call tracking           | `accumulateSubAgentUsage` (`claude.budget-stats.lib.mjs:612`) + `subAgentCallsByToolUseId` (`claude.lib.mjs:990`) |
| Sub-session segmentation          | `currentSubSession` block (`claude.lib.mjs:474-531`)                                                              |

No external dependencies are required for any of the plans above.
