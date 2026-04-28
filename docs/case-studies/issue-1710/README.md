# Case Study: Issue #1710 — Check and Fix Calculation Correctness

**Issue:** [link-assistant/hive-mind#1710](https://github.com/link-assistant/hive-mind/issues/1710)
**Pull Request:** [#1711](https://github.com/link-assistant/hive-mind/pull/1711)
**Triggering report:** [PR #1707 comment 4335847447](https://github.com/link-assistant/hive-mind/pull/1707#issuecomment-4335847447)
**Labels:** `bug`
**Reported by:** @konard on 2026-04-28
**Status:** Investigation / case study (no code change yet)

---

## 1. Reported observations (verbatim from the issue)

The issue body lists four "strange things" pulled from the cost summary that the
solver wrote into the conversation comment of PR #1707:

```
### 💰 Cost estimation:
- Public pricing estimate: $25.637806
- Calculated by Anthropic:  $25.677806
- Difference:               $0.040000 (+0.16%)
```

```
Claude Haiku 4.5:
- 4.2K / 64K (7%) output tokens
Total: 135.5K input tokens, 4.2K output tokens, $0.170824 cost
```

> _"Haiku sub-session does not include input tokens calculation."_
> _"Haiku total does not show cached input tokens separately."_

```
Claude Opus 4.7:
- 278.2K / 1M (28%) input tokens, 79.6K / 128K (62%) output tokens
Total: (342.2K + 42.7M cached) input tokens, 79.6K output tokens, $25.466982 cost
```

> _"For claude input tokens in total and in sub-session calculation does not match."_

The issue ends with two normative requirements:

> _"Sub-sessions should not include cached tokens, but totals always should show separately cached tokens."_

The remainder of the body asks for:

1. Download all related logs and data into `./docs/case-studies/issue-1710`.
2. Reconstruct timeline / sequence of events.
3. List each requirement.
4. Find the root cause of each problem.
5. Propose solutions / solution plans (incl. existing components/libraries).
6. If data is insufficient, add debug output / verbose mode for the next iteration.
7. If the issue is related to upstream projects, file reproducible bug reports there.

This case study addresses items 1–7.

---

## 2. Source data captured for this case study

| Path                                                                           | What it is                                                                            |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| [`data/issue-1710.json`](./data/issue-1710.json)                               | Raw JSON of the GitHub issue.                                                         |
| [`data/comment-4335847447.json`](./data/comment-4335847447.json)               | Raw JSON of the PR #1707 comment that triggered the report.                           |
| [`data/solution-draft-log-pr-1707.txt`](./data/solution-draft-log-pr-1707.txt) | Full 6.7 MB solver log gist linked from the comment, downloaded for offline analysis. |
| [`facts.md`](./facts.md)                                                       | The **actual numbers** Anthropic returned for that run, distilled from the log.       |
| [`root-causes.md`](./root-causes.md)                                           | Per-symptom root cause analysis with file/line citations.                             |
| [`solution-plans.md`](./solution-plans.md)                                     | Per-requirement solution plan, including library/component options.                   |
| [`upstream.md`](./upstream.md)                                                 | Upstream / third-party reports we should consider filing.                             |

Anyone trying to reproduce the case can replay the original cost-summary
rendering from the captured numbers using the unit tests in
[`tests/test-issue-1600-budget-stats.mjs`](../../../tests/test-issue-1600-budget-stats.mjs)
plus the new fixture documented in [`facts.md`](./facts.md).

---

## 3. Timeline / sequence of events

| Date (UTC)          | Event                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-04-28 13:18:16 | Solver run for issue #1706 starts (`solve … #1706 --model opus --tool claude --attach-logs`).                                                                |
| 2026-04-28 13:51:50 | Claude Code emits the final `result` JSON event. Anthropic-reported cost: **$25.677806**. Per-model usage payload includes `webSearchRequests: 4` for Haiku. |
| 2026-04-28 13:52:21 | Solver's local rendering pipeline (`displayBudgetStats` → `displayCostComparison`) prints the formatted summary into the run log.                            |
| 2026-04-28 13:52:24 | The same summary is posted to PR #1707 as comment `4335846001`.                                                                                              |
| 2026-04-28 13:52:35 | Log gist (the one we re-downloaded) is published as comment `4335847447`.                                                                                    |
| 2026-04-28 13:58:24 | @konard files issue **#1710** with the four "strange things".                                                                                                |
| 2026-04-28 13:59:26 | Solver branch `issue-1710-16bcd58d1d40` and draft PR **#1711** are auto-created.                                                                             |
| 2026-04-28 14:0x    | This case study is written; no production code is changed yet.                                                                                               |

The crucial point: **all four reported anomalies are deterministically
reproducible from the JSON in `data/comment-4335847447.json` plus the result
event found at line ~66725 of `data/solution-draft-log-pr-1707.txt`.** They are
not flaky.

---

## 4. Requirements extracted from the issue

| #              | Requirement                                                                                                                                                                         | Source phrase                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| R1             | The "Difference: $0.040000 (+0.16%)" line should not be surprising — either the discrepancy must be explained in the breakdown or the local estimator must match Anthropic exactly. | _"Strange things: Difference: $0.040000 (+0.16%)"_                                                         |
| R2             | Each Haiku sub-session/sub-agent line **must include input-token information** (not only output tokens).                                                                            | _"Haiku sub-session does not include input tokens calculation."_                                           |
| R3             | Sub-session and total input-token figures for the same model must reconcile (or the report must clearly explain that they describe different metrics).                              | _"For claude input tokens in total and in sub-session calculation does not match."_                        |
| R4             | The Total line must always present cached vs. non-cached input tokens separately, including for Haiku.                                                                              | _"Haiku total does not show cached input tokens separately."_                                              |
| R5 (normative) | Sub-session lines should **exclude** cached tokens; Total lines should **always** show cached tokens separately.                                                                    | _"Sub-sessions should not include cached tokens, but totals always should show separately cached tokens."_ |
| R6             | Compile this case study (data, timeline, root causes, plans).                                                                                                                       | _"compile that data to `./docs/case-studies/issue-{id}` folder"_                                           |
| R7             | If data is insufficient, **add debug/verbose output** so the next iteration can find the root cause.                                                                                | _"add debug output and verbose mode if not present"_                                                       |
| R8             | File reproducible upstream issues where applicable.                                                                                                                                 | _"If issue related to any other repository/project … please do so."_                                       |

---

## 5. Findings at a glance

> See [`root-causes.md`](./root-causes.md) for the long version.

- **R1 — `$0.040000` cost difference.** Local cost estimator
  [`calculateModelCost`](../../../src/claude.lib.mjs) only sums input / cache-write / cache-read / output dollars.
  It **does not bill server-side tools.** The Anthropic result event for that
  run reported `claude-haiku-4-5-20251001.webSearchRequests = 4`. At the
  documented Anthropic price of **$10 / 1 000 web searches**
  (≡ $0.01/req, [pricing docs](https://platform.claude.com/docs/en/about-claude/pricing#web-search-tool)),
  4 × $0.01 = **$0.04** — the _exact_ delta the issue calls out. The discrepancy
  is real but it is structural, not arithmetic.

- **R2 — Haiku sub-session is missing the input-tokens half.** In
  `claude.budget-stats.lib.mjs` the function `formatContextOutputLine` only adds
  the input-tokens phrase when `contextLimit && peakContext > 0`. For Haiku,
  `peakContextUsage` stays at `0` because Haiku is invoked **as a sub-agent**
  (the Agent tool's child model). Sub-agent traffic is observed only via the
  parent's stream events, never via the JSONL `assistant` records that drive
  `peakContextByModel`. The same `peakContext === 0` branch later also forces
  an output-only fallback line at lines 461–465. Net effect: Haiku is rendered
  output-only.

- **R3 — Opus "278.2K vs 342.2K" mismatch.** The two numbers are answering two
  different questions:
  - `278 218` = `peakContextUsage` for Opus = the **single largest request's**
    `input + cache_creation + cache_read` (claude.lib.mjs:501).
  - `342 207` = cumulative across the whole session of `inputTokens + cacheCreationTokens`
    (i.e. `690 + 341 517` — see `data/solution-draft-log-pr-1707.txt` line 66726–66730).
  - `42 679 751` = cumulative `cacheReadInputTokens`.
    So the relation is **peak ≠ Σ(cumulative non-cached) + Σ(cumulative cached)**;
    it is supposed to be `peak ≤ contextLimit` per request, while the cumulative
    totals can vastly exceed the window over the lifetime of the run. The output
    format does not communicate this and invites the exact misreading the issue
    reports.

- **R4 — Haiku total has no `(X + Y cached)` form.** In our specific run,
  `cacheReadInputTokens` for Haiku is genuinely **zero**, so the existing
  conditional collapses to the short `135.5K input tokens` form on purpose.
  However: (a) the _concatenated_ `inputTokens + cacheCreationTokens` value
  hides the 57 580 cache-creation tokens and (b) the user expects the verbose
  `(X + Y cached)` format to appear _whenever_ any cache activity exists, even
  when only cache writes (5m / 1h) happened. Today the conditional keys on
  `cache_read` only.

---

## 6. Solution plans (summary)

> Detailed plans, including code-level diffs and test sketches, are in
> [`solution-plans.md`](./solution-plans.md). One paragraph per item here:

- **R1**: Track and price `webSearchRequests` (already captured per-model).
  Add `web_search.cost_per_request = 0.01` to the model-info shape used by
  `calculateModelCost`. As a defensive fallback, when Anthropic's
  `costUSD` is present, use it as the source of truth and reserve the public
  estimate purely for transparency / cross-check. Show a one-line "Note:
  4 web search requests × $0.01 = $0.04 (server-tool cost)" in the breakdown
  whenever the residual matches a known server-tool cost.

- **R2**: In `claude.budget-stats.lib.mjs`, when `peakContext === 0` but the
  per-model totals exist, render the input half from cumulative totals using
  the same `(X + Y cached) input tokens` form the Total line uses, just
  without a percentage (since no per-request peak is known). Drop the
  output-only fallback for sub-agent Haiku.

- **R3**: Either label the sub-session line as
  `peak request: ...` and the Total line as `cumulative: ...`, or display the
  sub-session line as cumulative-non-cached so the figures reconcile by
  arithmetic. Plan A keeps the existing, technically-meaningful "peak per
  request" semantics and adds a label; Plan B aligns numbers at the cost of
  losing the per-request fill % vs. context window. The PR proposes both
  options with a recommendation for Plan A (label) plus an explanatory legend.

- **R4**: Change the conditional in `buildBudgetStatsString`
  (`claude.budget-stats.lib.mjs:471`) so it switches to the
  `(X + Y cached)` form whenever **any** of `cacheCreationTokens`,
  `cacheReadTokens`, `cacheCreation5mTokens`, `cacheCreation1hTokens` is
  non-zero. Optional: also surface the 5m vs 1h cache write split, since the
  per-million pricing differs (1.25× vs 2× input).

- **R5 (normative)**: Make sub-session input numbers exclude cache reads by
  default (use `requestInputNonCached = input + cache_creation` for the peak
  metric, and add `cache_read` separately on the Total line). This is a
  clean, single-place change in `claude.lib.mjs:501` that follows the issue's
  explicit rule.

- **R6**: ✅ Done — this folder.

- **R7**: Add a structured `--verbose-budget` (or reuse existing `--verbose`)
  trace that prints, **once per model**: peak per-request triple
  `(input, cache_creation, cache_read)`, cumulative quadruple, source
  (JSONL vs. result-event), and the cost breakdown including server-tool
  costs. This trace is what we wished we had **before** filing #1710.

- **R8**: Two upstream issues are good candidates:
  1. `anthropics/claude-code` — request that the per-call `usage` payload for
     sub-agent (Agent tool) calls expose `peak_context_usage` so external
     accounting can reconcile sub-agent tokens to the same window metric the
     CLI uses. (See [`upstream.md`](./upstream.md) for the reproducer.)
  2. Anthropic API docs — request that `costUSD` in the result event include
     a per-component breakdown (the documented `web_search_requests` is
     billed but is not currently itemised in the JSON we receive).

---

## 7. Why no production code change in this PR

The user explicitly wrote _"If there is not enough data to find actual root
cause, add debug output and verbose mode … on next iteration."_ This case
study **does** find each root cause and prescribes a fix per requirement, but
several of the proposed fixes (especially R3 and R5) are user-facing format
changes that should be reviewed before being shipped — exactly because the
last format reshuffle in #1600 is what created the confusing "278.2K vs
342.2K" rendering in the first place.

The PR therefore lands the case study + reproducer fixtures + the upstream
plan, leaving the actual format and pricing changes to a follow-up PR that
references this document.

---

## 8. Existing components / libraries reviewed

| Need                                | Library / component already in repo                                                                                              | Verdict                                                                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Decimal arithmetic for cost diff    | `decimal.js-light` (already used in `github-cost-info.lib.mjs:69-70`)                                                            | ✅ Reuse for any new cost-component math.                                                                                                      |
| Token formatting (`K`/`M` suffixes) | private `formatTokensCompact` in `claude.budget-stats.lib.mjs:291-295`                                                           | ✅ Reuse; do not introduce a competing helper.                                                                                                 |
| Per-model usage merging             | `mergeResultModelUsage` (`claude.budget-stats.lib.mjs:234-284`)                                                                  | ✅ Already merges Haiku / sub-agent data from the result event — this is the single point we will extend to populate cache-creation breakdown. |
| Sub-agent call accounting           | `accumulateSubAgentUsage` (`claude.budget-stats.lib.mjs:612-617`) and `subAgentCallsByToolUseId` map in `claude.lib.mjs:990-991` | ✅ Already collects per-call cache reads / creations; we just need to expose them in the rendered output.                                      |

No external packages are needed.

---

## 9. Quick reference: file:line citations used

- `src/claude.lib.mjs:390-438` — `calculateModelCost` (no server-tool pricing).
- `src/claude.lib.mjs:499-521` — `requestContext` / `peakContextByModel` / sub-session accumulation.
- `src/claude.lib.mjs:553` — attaches `peakContextUsage` per model.
- `src/claude.budget-stats.lib.mjs:127-148` — `displayCostComparison` (cost + diff line).
- `src/claude.budget-stats.lib.mjs:159-225` — `displayBudgetStats` (per-model bullet + Total line in solver log).
- `src/claude.budget-stats.lib.mjs:308-339` — `formatSubSessionsList`, `formatContextOutputLine`.
- `src/claude.budget-stats.lib.mjs:409-544` — `buildBudgetStatsString` (PR comment renderer).
- `src/claude.budget-stats.lib.mjs:554-584` — `buildAgentBudgetStats` (Agent CLI bridge).
- `src/github-cost-info.lib.mjs:24-74` — `buildCostInfoString` (cost block in PR comment).
