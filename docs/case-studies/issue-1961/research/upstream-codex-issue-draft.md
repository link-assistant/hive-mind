# Draft upstream report for openai/codex

> Status: DRAFT — not yet filed. Filing is an outward-facing action left for
> maintainer confirmation. Target repository: https://github.com/openai/codex
> Use the "CLI" issue template (`3-cli.yml`): fill in version, the plan/account
> type, exact reproduction, and `codex doctor` output before submitting.

## Title

`codex exec --json`: expose per-request / per-compaction token usage in the JSON
event stream (only cumulative `turn.completed` is emitted today)

## What happened

`codex exec --json` emits a JSONL event stream. The only token-usage event in the
documented stream is `turn.completed`, whose `usage` object is **cumulative for
the whole run**:

```json
{
  "type": "turn.completed",
  "usage": {
    "input_tokens": 11827490,
    "cached_input_tokens": 11407616,
    "output_tokens": 36485,
    "reasoning_output_tokens": 10057
  }
}
```

When a run auto-compacts (here, one successful `/responses/compact` at
`context_window=200000`, `auto_compact_token_limit=150000`), there is no event in
the JSON stream that reports the token usage of the segment **before** vs
**after** the compaction. Downstream tools that want to show "context fullness per
sub-session" therefore cannot do it from the documented JSON contract.

The data does exist, but only in the human-oriented debug telemetry
(`codex_otel.log_only`, visible under `RUST_LOG=debug`): each API request logs a
`codex.sse_event response.completed` line carrying that request's
`input_token_count` / `cached_token_count` / `output_token_count` /
`reasoning_token_count`. By bucketing those per-request snapshots around the
`/responses/compact` boundary we reconstructed the real per-sub-session peak
restored context (137,188 then 120,553 tokens for the run above). But this relies
on parsing unstructured debug logs, which is fragile and not part of any stable
contract.

This also appears related to openai/codex#17539, which notes that the `exec`
JSONL output discards the per-call `.last` usage and emits only the cumulative
`.total`.

## What I expected

One of:

1. A per-request usage field in the JSON stream (e.g. a `last_usage` /
   `request.completed` event mirroring the SSE `response.completed` counts), or
2. A first-class compaction event in the JSON stream that reports the token usage
   of the segment it is compacting (pre-compaction context size + output
   generated since the previous compaction).

Either would let tools report per-segment context usage without scraping
`RUST_LOG=debug` output.

## Reproduction

1. Run a long `codex exec --json` task that exceeds `auto_compact_token_limit`
   so auto-compaction triggers at least once. (To observe the debug telemetry
   that _does_ contain the data, additionally set `RUST_LOG=debug`.)
2. Collect the JSONL stream.
3. Observe: the only usage event is the final cumulative `turn.completed`; there
   is no per-request or per-compaction usage event in the JSON stream.
4. Observe in the `RUST_LOG=debug` output that the data is present as
   `codex_otel.log_only event.name="codex.sse_event" event.kind=response.completed input_token_count=...`
   lines — i.e. Codex already computes it, it is just not surfaced in JSON.

## Environment

- `codex --version`: _<fill in>_
- Plan / account type: _<fill in>_
- `codex doctor`: _<paste output>_

## Why it matters

Cumulative-only usage makes any per-segment ("between compactions") accounting
impossible from the supported interface, and pushes integrators toward scraping
debug logs. Surfacing per-request usage (or a per-compaction usage event) in the
JSON stream would make precise, stable token accounting possible for
non-interactive integrations.
