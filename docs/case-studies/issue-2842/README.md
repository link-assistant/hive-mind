# Issue #2842: Codex cost estimate always used long-context pricing

## Incident

`solve 2.34.0 --tool codex`, model `gpt-6.1-sol`, `-c model_context_window=200000`
(Godmy/stylist-svelte#3 → PR #4). All 6 sessions logged:

```
📈 Codex usage from turn.completed: 169,568 input, 2,508,288 cache read, 26,787 output across 1 turn(s)
💰 Codex public pricing estimate: $1.581735
   Long-context pricing applied because peak prompt exceeded 272,000 input tokens
```

Raw event: `{"type":"turn.completed","usage":{"input_tokens":2677856,"cached_input_tokens":2508288,...}}`.
The largest single request in the Codex diagnostics was `input_token_count=149702`,
and a request sent with a 200K window cannot exceed 272K.

## Root cause

`parseCodexExecJsonOutput` (`src/codex.lib.mjs`) set
`peakContextUsage = input_tokens + cache_write_tokens` from `turn.completed`.
`codex exec` runs **one turn containing many model requests**, so that number is
the sum of every request's prompt (2,677,856 here), not the size of any one
prompt. `calculateCodexPricingFromModelInfo` then compared it with
`CODEX_LONG_CONTEXT_PRICE_THRESHOLD = 272000`, which OpenAI applies **per
request**. Any non-trivial session therefore crossed the threshold.

## Evidence that per-request counts are available

Codex writes one OTEL record per model response on stderr (each twice, as
`log_only` and `trace_safe`), e.g. from
`docs/case-studies/issue-1990/raw/isolation-docker-ef57d6aa-385b-4ebf-8d27-52a32007984b.log.txt`:

```
INFO codex_otel.log_only: event.name="codex.sse_event" event.kind=response.completed input_token_count=14377 output_token_count=556 cached_token_count=4992 ...
```

`input_token_count` includes cached tokens (14,377 ≥ 4,992 cached), so it is the
full prompt of that request — exactly what the long-context threshold measures.

## Fix

- `src/codex.diagnostics.lib.mjs` parses `input_token_count` from
  `codex.sse_event` / `event.kind=response.completed` lines and keeps the
  maximum in `tokenUsage.peakRequestInputTokens`.
- `turn.completed` totals are kept separately in `turnPeakContextUsage` and used
  only as a fallback upper bound.
- `resolveCodexPeakContextUsage` returns the per-request peak when known;
  otherwise the turn total capped at the context window (`tokenUsage.contextLimit`
  from diagnostics or from our own `-c model_context_window=…` override, else the
  model's `limit.context` at pricing time).
- `executeCodexCommand` seeds `tokenUsage.contextLimit` from the
  `model_context_window` override it passes to Codex
  (`getCodexContextWindowFromConfigArgs`).
- The log line now reports the peak it used:
  `Long-context pricing applied because peak single-request prompt (N) exceeded 272,000 input tokens`.

For the incident numbers, the estimate drops from long-context rates to
short-context rates (see `tests/codex-peak-context-pricing-2842.test.mjs`).

## Remaining limits

- Per-request SSE records are only guaranteed when Codex logs at debug level
  (`--verbose` sets `RUST_LOG=debug`). Without them, the capped turn total is
  used; with a short-context window (272K) this can never cross the threshold,
  but a long-context run without diagnostics still falls back to an upper bound.
- Sub-agent (`spawn_agent`) requests share the stderr stream and are counted
  toward the peak, which is correct for billing since each is its own request.
