---
'@link-assistant/hive-mind': patch
---

fix(cost): accumulate Anthropic cost across limit-reset resumes (#1886)

The session cost summary could report a large negative "Difference" (e.g.
`$-11.422796 (-31.66%)`) between the public pricing estimate and the Anthropic
figure. Root cause: the public estimate is computed from the session JSONL,
which accumulates the **entire** session across every limit-reset resume, while
the Anthropic `total_cost_usd` from the stream-json `result` event is scoped to a
**single** Claude process (only the resumed run). Comparing a full-session
estimate against a single-process figure produced a misleading gap even though
both numbers were individually correct.

The per-token math (`calculateModelCost`) was audited and is correct; this is a
scope mismatch, not a pricing error.

Fix:

- New `src/anthropic-cost-accumulator.lib.mjs` keeps a model-agnostic running
  total of Anthropic's per-process `total_cost_usd` (it sums dollars, never
  inspecting per-token prices, so it is correct for all models).
- `runClaude` seeds from and returns the cumulative total on every terminal path;
  the cross-process limit-reset resume threads it via a new hidden
  `--previous-anthropic-cost` option (`autoContinueWhenLimitResets`).
- A usage-limit hit ends as `is_error` with no `success` result event, so its
  cost was previously discarded. The cost from a non-success terminal `result`
  event is now kept as a fallback and folded into the accumulator, closing the
  gap in the reported scenario.
- `displayCostComparison` / `displaySessionTokenUsage` print a verbose
  accumulation breakdown ("cumulative across resume iterations: this run … +
  carried forward … = …") so the figure is never mysterious again.

A deep case study (timeline, proven root causes, exact reproduced numbers, online
prior art incl. `anthropics/claude-code#13088`) is compiled under
`docs/case-studies/issue-1886/`.
