# Issue #1710 — Upstream issues to file

The user explicitly asked: _"If issue related to any other repository/project,
where we can report issues on GitHub, please do so. Each issue must contain
reproducible examples, workarounds and suggestions for fix the issue in code."_

Of the four symptoms, three (B, C, D) are entirely fixable inside this
repository — see [`solution-plans.md`](./solution-plans.md). Two questions are
genuine upstream gaps and would benefit from being raised with Anthropic /
the Claude Code project.

The drafts below are ready to be filed once a maintainer agrees. They are not
filed automatically by this solver run because the repository policy requires
human approval before opening issues against external projects. Each draft is
self-contained: title, repo, body in upstream Markdown.

---

## Upstream #1 — Sub-agent (Agent tool) usage events lack `peak_context_usage`

**Repository.** `anthropics/claude-code`
**Type.** Feature request / API observability
**Priority for us.** Low — we have a workaround (cumulative-only display).

### Title

> Expose `peak_context_usage` for sub-agent (Agent tool) calls in the
> stream-json result event

### Body

**Summary.** When the Agent tool is used to launch a sub-agent (e.g. Opus
delegating to Haiku), the sub-agent's per-request peak context fill is not
exposed in the stream-json events that the parent receives. As a result,
external accounting tools cannot render a "peak request: N / contextLimit"
metric for sub-agent models, even though they can reconcile cumulative
totals via `result.modelUsage[<sub-agent-model>]`.

**Reproducer (against `claude-code` 1.x, stream-json mode).**

1. Run any prompt that delegates work to an Agent (`Agent({ subagent_type: …, model: 'haiku', … })`).
2. Capture the stream-json output (`--output-format stream-json`).
3. Inspect the final `type: 'result'` event:

   ```json
   "modelUsage": {
     "claude-haiku-4-5-20251001": {
       "inputTokens": 77969,
       "cacheCreationInputTokens": 57580,
       "cacheReadInputTokens": 0,
       "outputTokens": 4176,
       "webSearchRequests": 4,
       "costUSD": 0.210824,
       "contextWindow": 200000,
       "maxOutputTokens": 32000
     }
   }
   ```

   Note the absence of any `peakContextUsage` /
   `maxRequestContext` / similar field for the sub-agent.

4. Inspect the per-call `system / task_notification` events that fire when
   a sub-agent finishes — they include a single `total_tokens` value but
   not a per-request peak.

**Why it matters.**

- Hive Mind's PR comment renderer
  ([`claude.budget-stats.lib.mjs`](https://github.com/link-assistant/hive-mind/blob/main/src/claude.budget-stats.lib.mjs))
  shows `peak / contextLimit (%)` for the primary model, but cannot do the
  same for sub-agent models. The current workaround is a less informative
  output-only line.
- Operators want to know whether the sub-agent ever came close to its own
  context limit (200K for Haiku, 400K for Sonnet, etc.) — that's an
  important signal for tuning prompt size.

**Suggested fix (in upstream).**

Add a `peakContextUsage` integer to each entry of `modelUsage` in the result
event, computed as the largest `input_tokens + cache_creation_input_tokens

- cache_read_input_tokens`value seen across the sub-agent's API calls.
Alternatively, include`usage.peak_context_usage`on each`task_notification` event.

**Workaround we use today.** Render the cumulative
`(input + cache_creation + cache_reads cached)` form for sub-agent models
and label them as "cumulative only" — see Hive Mind issue
[link-assistant/hive-mind#1710](https://github.com/link-assistant/hive-mind/issues/1710).

---

## Upstream #2 — Result event `costUSD` is opaque (no per-component breakdown)

**Repository.** `anthropics/claude-code` (or Anthropic's API docs repo if
they prefer)
**Type.** Documentation / observability
**Priority for us.** Medium — without this, every web-search / future
server-tool run will produce a "Difference: $X" line in any external
estimator.

### Title

> Provide a per-component cost breakdown alongside `costUSD` in the
> stream-json result event

### Body

**Summary.** The `result` event includes a single `costUSD` figure per
model, but no breakdown by component (input tokens, output tokens, cache
write tier, cache read, server-tool usage). Independent estimators that
re-derive the value from public per-million-token prices will diverge
whenever a server-side tool (web search today; presumably more in future)
is involved, because those tools are billed but not itemised.

**Reproducer.** Run a Haiku session that uses `web_search`. The result
event reports e.g.

```json
"claude-haiku-4-5-20251001": {
  "inputTokens": 77969,
  "cacheCreationInputTokens": 57580,
  "cacheReadInputTokens": 0,
  "outputTokens": 4176,
  "webSearchRequests": 4,
  "costUSD": 0.210824
}
```

A naive estimator using only the `MTok` rates from
`claude.com/docs/en/about-claude/pricing` computes
`$0.077969 + $0.071975 + $0.020880 = $0.170824`. The remaining
`$0.04 = 4 × $0.01` is the (documented) web-search charge, but it is not
labelled in the JSON. Any external dashboard will show a stable "+$0.04"
delta on every Haiku-with-web-search run and look broken.

**Suggested fix.**

Either (preferred) expose the breakdown directly:

```jsonc
"costUSD": 0.210824,
"costBreakdown": {
  "input":         0.077969,
  "cache_write":   0.071975,
  "cache_read":    0.000000,
  "output":        0.020880,
  "server_tools":  { "web_search": 0.040000 }
}
```

…or (minimum) explicitly document at
`platform.claude.com/docs/en/about-claude/pricing` that `costUSD` in the
result event includes server-tool charges, and link the per-tool rates from
that paragraph.

**Workaround we use today.** Hive Mind's renderer treats Anthropic's
`costUSD` as authoritative; the public estimate is shown only for
transparency. We additionally plan to teach our `calculateModelCost` to
charge web searches at `$0.01/req` so the displayed difference rounds to
zero (see Hive Mind issue
[link-assistant/hive-mind#1710](https://github.com/link-assistant/hive-mind/issues/1710),
solution plan R1).
