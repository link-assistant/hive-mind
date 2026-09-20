# Issue #1710 — Root cause analysis (per symptom)

Each section quotes the user's complaint, the rendered output that triggered
it, the code path that produced that output, and the underlying defect.

---

## Symptom A — `Difference: $0.040000 (+0.16%)` looks suspicious

**Rendered output**

```
- Public pricing estimate: $25.637806
- Calculated by Anthropic: $25.677806
- Difference:              $0.040000 (+0.16%)
```

**Producing code**
[`src/github-cost-info.lib.mjs:66-71`](../../../src/github-cost-info.lib.mjs)
_(PR comment renderer)_
[`src/claude.budget-stats.lib.mjs:127-148`](../../../src/claude.budget-stats.lib.mjs)
_(solver-log renderer)_

**Public total is computed by**
[`src/claude.lib.mjs:390-438` — `calculateModelCost`](../../../src/claude.lib.mjs)

```js
// Only these four cost components are counted:
//   input × cost.input
//   cache_creation × cost.cache_write
//   cache_read × cost.cache_read
//   output × cost.output
```

**Defect.** `calculateModelCost` does **not** charge for any server-side tool
usage. The Haiku result event for the run shows
`webSearchRequests = 4`. Per Anthropic's published pricing
([web search tool](https://platform.claude.com/docs/en/about-claude/pricing#web-search-tool)),
each web search costs **$0.01** (= $10 / 1 000 searches). 4 × $0.01 = **$0.04**,
which is exactly the displayed delta. The `+0.16 %` figure is the same delta
expressed as a fraction of the public total ($0.04 / $25.637806 ≈ 0.156 %).

**Why it looks "wrong" to a human reader.** The "Difference" line presents the
delta as if our local calculator simply has a precision bug, when in fact our
calculator is _systematically_ missing one of Anthropic's billable line items.

**Severity.** Low — the Anthropic-reported value is shown alongside, so the
final number is correct. However, every Haiku/Sonnet web-search-using run will
show a non-zero diff and erode trust in the cost section.

---

## Symptom B — Haiku sub-session is missing the input-tokens phrase

**Rendered output**

```
**Claude Haiku 4.5:**
- 4.2K / 64K (7%) output tokens
```

**Producing code**

`buildBudgetStatsString` in
[`src/claude.budget-stats.lib.mjs:454-465`](../../../src/claude.budget-stats.lib.mjs):

```js
const peakContext = usage.peakContextUsage || 0;

if (showSubSessions) {
  stats += formatSubSessionsList(subSessions, contextLimit, outputLimit);
} else if (peakContext > 0) {
  stats += formatContextOutputLine(peakContext, contextLimit, usage.outputTokens, outputLimit, '- ');
} else if (outputLimit && callCount <= 1) {
  // Issue #1600: Show output-only detalization for sub-agent single sessions
  const outPct = ((usage.outputTokens / outputLimit) * 100).toFixed(0);
  stats += `\n- ${formatTokensCompact(usage.outputTokens)} / ${formatTokensCompact(outputLimit)} (${outPct}%) output tokens`;
}
```

**Why `peakContext === 0` for Haiku.** Look at where the value is populated:
[`src/claude.lib.mjs:499-508`](../../../src/claude.lib.mjs)

```js
const requestContext = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
const model = entry.message.model; // <-- comes from the JSONL line
if (requestContext > (peakContextByModel[model] || 0)) {
  peakContextByModel[model] = requestContext;
}
```

`peakContextByModel` is keyed by the model name on the JSONL `assistant`
message. Haiku is invoked **as a sub-agent** via the `Agent` tool. The JSONL
stream from the parent session never sees Haiku as the responding model — it
only sees the parent's response and the parent's `tool_use` block describing
that an Agent call was launched. The Haiku usage data arrives separately
through the result event (`mergeResultModelUsage`,
[`claude.budget-stats.lib.mjs:234-284`](../../../src/claude.budget-stats.lib.mjs)),
which copies cumulative tokens but _does not_ record a per-request peak.

So Haiku's `peakContextUsage` stays at the default `0`, the first two branches
above are skipped, and the third (output-only) branch fires.

**Defect.** When `peakContext === 0` we should still surface input
information from the cumulative totals we _do_ have
(`usage.inputTokens + usage.cacheCreationTokens` and `usage.cacheReadTokens`).
The current logic was added in #1600 specifically for "sub-agent single
sessions" but it deletes information instead of summarising it.

---

## Symptom C — Opus sub-session value (278.2K) does not equal Total

**Rendered output**

```
**Claude Opus 4.7:**
- 278.2K / 1M (28%) input tokens, 79.6K / 128K (62%) output tokens
Total: (342.2K + 42.7M cached) input tokens, 79.6K output tokens, $25.466982 cost
```

**Producing code**

- The `278.2K` figure is the **single-request peak** from
  `peakContextByModel` — see Symptom B's quote of
  [`src/claude.lib.mjs:499-508`](../../../src/claude.lib.mjs).
  It is `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`
  for _one_ API request — the largest such request in the run.
- The `342.2K + 42.7M cached` figures are cumulative across the entire run,
  computed in
  [`src/claude.budget-stats.lib.mjs:468-475`](../../../src/claude.budget-stats.lib.mjs):

  ```js
  const totalInputNonCached = usage.inputTokens + usage.cacheCreationTokens;
  const cachedTokens = usage.cacheReadTokens;
  if (cachedTokens > 0) {
    totalLine = `(${formatTokensCompact(totalInputNonCached)} + ${formatTokensCompact(cachedTokens)} cached) input tokens`;
  }
  ```

**Defect.** The two numbers describe **different metrics** but the labels
imply they are commensurable. A reader naturally tries to reconcile
`278.2K` with `(342.2K + 42.7M)` — and fails. Specifically:

- `278.2K` includes cache-read tokens (the run that caused the peak read
  cached prompt context).
- `342.2K` deliberately _excludes_ cache-read tokens and reports them
  separately.

So even within a single line we are mixing semantics: the sub-session line
folds cache reads in; the Total line splits them out. The user's normative
requirement — _"Sub-sessions should not include cached tokens, but totals
always should show separately cached tokens"_ — proposes the obvious fix:
make the sub-session metric exclude cache reads too.

---

## Symptom D — Haiku Total does not show cached input tokens separately

**Rendered output**

```
Total: 135.5K input tokens, 4.2K output tokens, $0.170824 cost
```

**Producing code**

Same block as Symptom C
([`src/claude.budget-stats.lib.mjs:468-475`](../../../src/claude.budget-stats.lib.mjs)):

```js
const totalInputNonCached = usage.inputTokens + usage.cacheCreationTokens; // 135 549
const cachedTokens = usage.cacheReadTokens; // 0
if (cachedTokens > 0) {
  /* "(X + Y cached) input tokens" */
} else {
  /*  "X input tokens" */
}
```

**Why the short form fires.** For this specific run Haiku has
`cacheReadInputTokens = 0` (Haiku sub-agents in this run only wrote cache,
they never re-used it). The conditional therefore picks the short form.

**Two distinct defects.**

1. **The conditional keys on `cacheReadTokens` only.** The user's mental
   model is "did _any_ cache event happen", which includes cache **writes**.
   Haiku in this run wrote 57 580 ephemeral-1h cache tokens (line 66740 of
   the log). Those are billed differently from base input tokens (1.25× or
   2× input rate) but the rendered `135.5K` silently fuses them with the
   real `77 969` input. The verbose `(X + Y cached)` form would communicate
   that mismatch in _both_ directions: cache reads **and** cache writes.
2. **The label `input tokens` is overloaded.** `totalInputNonCached =
inputTokens + cacheCreationTokens` mixes two different price categories
   under one label. This is a labelling bug independent of (1).

---

## Cross-cutting observations

- **The peak-context metric is the single source of confusion** — every one
  of the four symptoms is downstream of the choice (introduced in #1501) to
  show "max single-request context fill" using the _same_ phrase
  ("input tokens") that the cumulative section uses. Adding a label like
  `peak request:` or `largest single request:` solves R3 without touching
  any arithmetic.

- **All the data needed to fix R2 and R4 is already in the in-memory
  `usage` map.** No new instrumentation in Claude Code is required — only
  rendering changes and one extension to `calculateModelCost` for
  `webSearchRequests`.

- **Sub-agent per-request peak is the only data we genuinely cannot
  produce locally.** That is the only item where an upstream change
  (`anthropics/claude-code`) would help; see [`upstream.md`](./upstream.md).
