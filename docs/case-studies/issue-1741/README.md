# Issue 1741 Case Study: Wrong Context Window Usage Calculation for Claude Haiku and Sub-Agent Models

## Summary

The PR-comment budget-stats renderer reported `1.2M / 200K (583%)` for Claude
Haiku 4.5 in a multi-model session — a value that exceeds the model context
window by nearly 6×. The same wrong shape can appear for any model that runs
exclusively as a sub-agent (Anthropic's `Agent` tool: Haiku, Sonnet) because
the parent JSONL never records that model's per-request usage and we are left
with cumulative totals only.

## Reproduction

The reference output, captured in
[`PR #1044 comment 4361121804`][ref-comment]:

```text
**Claude Haiku 4.5:**
- 1.2M / 200K (583%) input tokens, 6.6K / 64K (10%) output tokens

Total: (94 new + 61.2K cache writes + 1.1M cache reads) input tokens, 6.6K output tokens, $0.219954 cost
```

The issue reporter's expected shape:

```text
- 62.3K / 200K (35.2%) input tokens, 6.6K / 64K (10%) output tokens
```

The numerator on the detail line should be `input + cache_creation`
(= "new + cache writes"). It must NOT include `cache_read`, because cache
reads represent the same cached prefix being replayed across many calls; they
inflate cumulative totals far beyond any single request's footprint.

[ref-comment]: https://github.com/link-assistant/hive-mind/pull/1044#issuecomment-4361121804

## Timeline

- 2026-04-23 — Issue [#1710][1710] reports that cache writes were silently
  fused into "input tokens" on the Total line. PR splits writes/reads into
  separate buckets, but at this point `peakContextUsage` is set to
  `input + cache_creation` (no reads) per request.
- 2026-04-29 — Issue [#1737][1737] argues the per-request peak should reflect
  the restored-context input pressure, i.e. `input + cache_creation +
cache_read`. PR #1738 lands and changes `peakContextUsage` accordingly.
  PR #1738 also introduces a Haiku-specific fallback (when `peakContextUsage
== 0` because the parent JSONL has no Haiku entries): the detail line
  switches to `getUsageInputTokens(usage)` which sums the **cumulative**
  `inputTokens + cacheCreationTokens + cacheReadTokens`.
- 2026-05-01 19:09 UTC — Solution draft for PR [#1044][pr-1044] posts the
  budget stats containing the broken Haiku row.
- 2026-05-02 05:02 UTC — Issue [#1741][this] filed. The reporter calls out
  that for cumulative (sub-agent) usage the correct numerator is
  `new + cache writes`, not the cumulative-with-reads sum, and asks for the
  same calculation model across all tools.

[1710]: https://github.com/link-assistant/hive-mind/issues/1710
[1737]: https://github.com/link-assistant/hive-mind/issues/1737
[pr-1044]: https://github.com/link-assistant/hive-mind/pull/1044
[this]: https://github.com/link-assistant/hive-mind/issues/1741

## Requirements (extracted from the issue body)

1. Sub-session / sub-agent context-fill display must use the cumulative
   `input + cache_creation` formula (not include cache_read), so the
   percentage stays comparable to the model context window.
2. Apply the same calculation model across **all** Claude integrations,
   `codex`, `agent`, `opencode`, `qwen`, `gemini`, both for direct CLI access
   and via the `agent-commander` shim.
3. Maximize de-duplication: extract the math into a shared helper and call
   it from each integration.
4. Sessions / sub-sessions listing must keep showing the per-row context
   percentage (input fill).
5. The Total line stays cumulative and keeps every detail
   (`new + cache_writes + cache_reads`).
6. Compile case-study artifacts under `docs/case-studies/issue-1741/`,
   including the data, root-cause analysis, and solution plan.
7. Add verbose / debug output if the existing logging is not enough to
   reconstruct the math when something looks off.
8. If the issue affects an upstream project, file a downstream report with
   reproduction, workaround, and code-level fix suggestion.
9. Plan and execute everything in a single PR until the requirement set is
   fully addressed.

## Data Collected

- `data/issue-1741.json` — full issue payload at filing time.
- `data/issue-1741-comments.json` — issue comments (empty at collection).
- `data/pr-1742.json` — initial draft PR metadata.
- `data/pr-1738.json` — predecessor PR that introduced the regression.
- `data/external-comment-4361121804.json` — full referenced GitHub comment
  containing the broken rendered output.

## External References

- Anthropic prompt caching docs define total input tokens as
  `cache_read_input_tokens + cache_creation_input_tokens + input_tokens`,
  but emphasise that `cache_read_input_tokens` are tokens **retrieved from
  cache for the request** — i.e. the same prefix can be charged as a read
  on N consecutive calls. Cumulating them yields a multiple of the actual
  window when many calls share a prefix.
  Source: <https://platform.claude.com/docs/en/build-with-claude/prompt-caching>
- OpenAI prompt-caching docs likewise expose cached prompt tokens through
  `usage.prompt_tokens_details.cached_tokens` as a _per-request_ field.
  Source: <https://developers.openai.com/api/docs/guides/prompt-caching>
- OpenAI docs also confirm prompt caching is automatic on recent models and
  that cached prompt tokens are reported separately from total prompt tokens;
  the Codex parser therefore keeps `cached_input_tokens` in totals while using
  a separate no-cache-read `contextFillInputTokens` for display.

## Root Causes

1. **R1 — Wrong cumulative formula in Haiku fallback.**
   `src/claude.budget-stats.lib.mjs` line 593:
   `getUsageInputTokens(usage)` = `inputTokens + cacheCreationTokens +
cacheReadTokens`. For sub-agent rows the totals are summed across many
   API calls, so cache_reads (the same cached prefix replayed) accumulate
   to many multiples of the model's window.

2. **R2 — Same wrong formula in the sub-agent multi-call estimator.**
   `src/claude.budget-stats.lib.mjs` line 660 builds the `aggregateInput`
   the same way before computing the per-call estimated fill, so each
   estimated row inherits the same inflation.

3. **R3 — Inconsistent per-tool semantics.**
   - Claude (JSONL parsing): per-request `input + cache_creation +
cache_read` (correct for a _single_ request's restored context).
   - Codex: raw turn peak used the restored prompt value, while budget display
     had no separate no-cache-read field.
   - agent-token-usage: per-step `input + cache.read` (no cache_write).
   - Gemini: `tokens.total`.
   - Qwen: no usage was parsed even when structured events included it.
   - agent-commander: fallback summaries passed `streamTokenUsage` but could
     drop `pricingInfo.tokenUsage`, so `verifyResults` could not build budget
     stats for non-Claude tools.
     The choice of formula is not derived from a single source of truth, so
     later-added tools risk drifting again.

4. **R4 — The semantic mismatch is hidden from the user.**
   The Total line correctly splits new / cache_writes / cache_reads, but the
   detail line shows a single number with no annotation, so a reader cannot
   tell whether the numerator includes cache_reads or not.

## Solution Plan

For each requirement we propose a concrete change:

| #   | Requirement                                                       | Implementation                                                                                                                                                                                                                                                                                                                    |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Cumulative-only (sub-agent) row must use `input + cache_creation` | Replace `getUsageInputTokens(usage)` with `getCumulativeContextInputTokens(usage)` (= `inputTokens + cacheCreationTokens`) at the two affected sites in `claude.budget-stats.lib.mjs`.                                                                                                                                            |
| 2   | Consistency across tools                                          | Extract the helper to a single export and use the same name (`getCumulativeContextInputTokens`) across `claude.lib.mjs`, `codex.lib.mjs`, `agent-token-usage.lib.mjs`, `gemini.lib.mjs`, etc. The helper documents the rationale (cache reads are replayed prefix → don't add them to a cumulative-only fill).                    |
| 3   | De-duplication                                                    | Replace ad-hoc `inputTokens + cacheCreationTokens + cacheReadTokens` arithmetic with the helper. Remove the cumulative variant of `getUsageInputTokens` to avoid future re-introduction.                                                                                                                                          |
| 4   | Sub-session percentage display                                    | Keep current per-sub-session `peakContextUsage` semantics for **claude** (it's the largest single-request restored context, that's correct because each entry is one request). For sub-agent fallback rows, switch to the cumulative-context formula. Both keep the `X / Y (Z%)` shape.                                           |
| 5   | Total line unchanged                                              | `buildCumulativeInputPhrase` retains the new / writes / reads split.                                                                                                                                                                                                                                                              |
| 6   | Case study                                                        | This file plus `data/`.                                                                                                                                                                                                                                                                                                           |
| 7   | Verbose output                                                    | The existing `dumpBudgetTrace` (gated on `verbose`) already prints the cumulative split. Add a per-model trace line that explicitly states the formula used for the detail row, to remove ambiguity.                                                                                                                              |
| 8   | Upstream reports                                                  | Anthropic Claude Code does not expose per-call sub-agent usage (tracked at [anthropics/claude-code#46520][upstream-46520]). The fix in this PR is local; once upstream lands per-call usage, we will be able to display the _peak_ sub-agent request fill. No new upstream issue is needed: the existing one is the same blocker. |
| 9   | Single PR                                                         | All work lands on `issue-1741-bce8d99a69e4` / PR [#1742][pr-1742].                                                                                                                                                                                                                                                                |

[upstream-46520]: https://github.com/anthropics/claude-code/issues/46520
[pr-1742]: https://github.com/link-assistant/hive-mind/pull/1742

### Why `input + cache_creation` (and not `input + cache_creation + cache_read`)

Cache reads describe the **same** cached prefix being replayed for repeated
calls. For a single request, `input + cache_creation + cache_read` measures
that request's restored-context size. For an aggregate over N requests, the
cache reads are double-counted: the prefix is created once
(`cache_creation`) and then re-read on every later call (`cache_read`).
Therefore:

- Single-request peak (`peakContextUsage`): correct value is
  `input + cache_creation + cache_read` — see issue #1737.
- Cumulative-only fallback (sub-agent rows where peak is unknown): correct
  value is `input + cache_creation` — see issue #1741.

The distinction is small but important; we encode both in named helpers so
future contributors can pick the right one without re-deriving the math.

## Implementation Completed

The PR now separates two concepts everywhere budget stats are rendered:

- `peakContextUsage`: restored prompt size for a concrete request/turn, used
  for diagnostics and pricing decisions that need the full request pressure.
- `contextFillInputTokens`: display numerator for cumulative session or
  sub-session rows, calculated by the shared `src/context-fill.lib.mjs` helper
  as `input + cache_write` with cache reads excluded.

Cross-tool audit result:

| Tool / path      | Direct CLI support                                                                                   | agent-commander support                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Claude           | Keeps request peaks for JSONL sub-sessions; result-event-only sub-agent rows use shared no-read fill | Metadata path is preserved; fallback Claude result cost remains unchanged              |
| Codex            | Adds `contextFillInputTokens` from non-cached input + cache writes while preserving restored peak    | Metadata/fallback token usage is normalized into `pricingInfo.tokenUsage`              |
| Agent / OpenCode | `agent-token-usage` records no-read context fill for every `step_finish` event                       | Fallback summaries keep token usage and render the same budget row                     |
| Gemini           | Structured `stats.models[*].tokens` now expose context fill and optional context/output limits       | Metadata/fallback token usage is normalized before `verifyResults` builds budget stats |
| Qwen             | Structured `usage` / `stats.models` events now populate token usage, result model usage, and limits  | Metadata/fallback token usage is normalized before budget rendering                    |

No new upstream issue was filed. The only upstream blocker identified remains
Claude Code's lack of per-call sub-agent JSONL records; this PR fixes the local
renderer and parser behavior for the telemetry that is available today.

### Worked example (issue body figures)

For Haiku in the linked PR comment:

```
input         = 94
cache_writes  = 61_200
cache_reads   = 1_100_000
output        = 6_600
```

- Wrong (current): `94 + 61_200 + 1_100_000 = 1_161_294` → `1.2M / 200K (583%)`.
- Right (proposed): `94 + 61_200 = 61_294` → `61.3K / 200K (31%)`.

(The reporter's `62.3K / 200K (35.2%)` is an example with rounded numbers.)

## Existing Components / Libraries

- The same shape (split cache-write vs. cache-read in the renderer) was
  already used by `buildCumulativeInputPhrase`. We reuse its splitting and
  add a single-number helper for the detail line.
- `Decimal` (decimal.js-light) already covers cost arithmetic; no extra
  dependency is needed for the token math.

## Verification Plan

- Unit tests added in `tests/test-issue-1741-haiku-context.mjs` covering:
  - Haiku result-event-only single-call rendering (regression for #1741).
  - Multi-call sub-agent estimator using the new formula.
  - The shared helper returns `input + cacheCreation/cacheWrite` (no
    cache_read) for Claude and non-Claude token shapes.
- Cross-tool regression coverage added/updated in:
  - `tests/test-agent-token-usage.mjs` for Agent/OpenCode direct parsing.
  - `tests/test-codex-support.mjs` for Codex `contextFillInputTokens`.
  - `tests/test-gemini-support.mjs` for Gemini structured stats.
  - `tests/test-qwen-support.mjs` for Qwen structured usage parsing.
  - `tests/test-agent-commander-option.mjs` for agent-commander fallback
    budget rendering.
