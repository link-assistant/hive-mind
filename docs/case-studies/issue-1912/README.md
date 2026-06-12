# Issue 1912 Case Study: Codex Auto-Compact Display

## Summary

Issue: https://github.com/link-assistant/hive-mind/issues/1912

The reported run used:

```bash
/codex https://github.com/link-assistant/web-search/pull/8 --think max --sub-session-size 125k --tool codex
```

The root cause was not that Codex ignored `--sub-session-size`. Hive Mind passed the expected Codex config and Codex performed two successful compact requests. The bug was in Hive Mind's Codex usage collection: it only parsed `codex exec --json` stdout events, where Codex currently reports one aggregate `turn.completed` usage event. The compact boundaries were present only in verbose diagnostics on stderr, so the final budget comment displayed one 354.1K session instead of compact-bounded sub-sessions.

## Data Collected

Raw data is in `raw-data/`.

- `issue-1912.json`: issue title, body, labels, and timestamps from GitHub.
- `issue-1912-comments.json`: issue comments; empty at investigation time.
- `pr-1913.json`: prepared PR metadata.
- `pr-1913-conversation-comments.json`, `pr-1913-review-comments.json`: PR comments/review comments; empty at investigation time.
- `key-log-lines.txt`: redacted compact-related lines extracted from the external 70 MB log.
- `key-log-context.txt`: redacted nearby context for the same key lines.

The full external log was streamed from:

```text
https://raw.githubusercontent.com/konard/public-logs/main/log-tmp-solution-draft-log-pr-1781301197467.txt/tmp-solution-draft-log-pr-1781301197467.txt
```

The full 70 MB log was not committed to avoid repository bloat; the committed excerpts contain the evidence used for this fix.

## Timeline

- 2026-06-12 21:21:48 UTC: Hive Mind logged `-c model_auto_compact_token_limit=125000`.
- 2026-06-12 21:21:49 UTC: Codex `conversation_starts` diagnostics confirmed `context_window=200000 auto_compact_token_limit=125000`.
- 2026-06-12 21:30:31 UTC: Codex emitted a successful `/responses/compact` request.
- 2026-06-12 21:40:46 UTC: Codex emitted a second successful `/responses/compact` request.
- 2026-06-12 21:53:10 UTC: Codex stdout emitted one aggregate `turn.completed` usage event: `input_tokens=7996733`, `cached_input_tokens=7642624`, `output_tokens=57353`.
- 2026-06-12 21:53:10 UTC: Hive Mind displayed `354,109 input ... across 1 turn(s)`, losing the two compact boundaries.

## Requirements

- Verify whether `--sub-session-size 125k` was actually passed to Codex.
- Verify whether Codex compacted during the run.
- Explain why the comment displayed a single 354.1K session.
- Fix the code path for `--tool codex`.
- Add a regression test that reproduces the issue.
- Preserve investigation data under `docs/case-studies/issue-1912`.

## Findings

Hive Mind already mapped `--sub-session-size 125k` to:

```text
-c model_auto_compact_token_limit=125000
```

Codex received it, as shown by the `codex.conversation_starts` diagnostic line:

```text
context_window=200000 auto_compact_token_limit=125000
```

Codex compacted twice, as shown by two successful diagnostic records:

```text
event.name="codex.api_request" http.response.status_code=200 endpoint="/responses/compact"
```

The `codex exec --json` stream only exposed aggregate final usage:

```json
{ "type": "turn.completed", "usage": { "input_tokens": 7996733, "cached_input_tokens": 7642624, "output_tokens": 57353, "reasoning_output_tokens": 21471 } }
```

Hive Mind subtracted cached input and showed `354,109` non-cached input tokens, but it did not parse the diagnostic compact records. That is why the budget stats showed one session.

## External Facts Checked

The current Codex manual documents:

- `codex exec --json` emits JSONL events such as `thread.started`, `turn.started`, `item.*`, and `turn.completed`.
- One-off config overrides use `-c key=value`.
- `model_auto_compact_token_limit` is a Codex config key.
- Codex can automatically compact context for longer tasks.

The important implication is that compact boundaries are not currently a first-class `--json` event in the stream used by Hive Mind, so Hive Mind must treat verbose diagnostics as supplemental evidence when they are available.

## Solution

Implemented in this PR:

- Parse Codex diagnostic lines in the same parser used for JSON stdout.
- Parse stderr chunks from `executeCodexCommand`, because Codex diagnostics arrive there.
- Capture:
  - `context_window`
  - `auto_compact_token_limit`
  - successful `codex.api_request` records for `endpoint="/responses/compact"`
- Rebuild estimated sub-session rows from compact count plus aggregate `turn.completed` usage.
- Preserve exact aggregate totals in the Total line.
- Mark compact-derived sub-session rows as estimates in the rendered budget stats.
- Preserve sub-session rows in the generic budget-stats adapter used by Codex pricing info.

For the reported run, the two compact records produce three displayed sub-sessions. Since Codex only exposes aggregate token usage, per-sub-session token allocation is estimated; the total remains exact.

## Regression Coverage

`tests/test-codex-support.mjs` now covers:

- A parser-level reproduction using the exact Codex 0.139 diagnostic shape from the log.
- Preservation and rendering of compact-derived sub-session rows through budget stats.
- The real `executeCodexCommand` stream path where compact diagnostics arrive on stderr.

## Upstream Issue Decision

No external issue was filed. The observed behavior is explainable from the available Codex event surfaces: aggregate usage is in JSON stdout, compact events are in diagnostics. The Hive Mind bug was failing to parse and preserve those diagnostics. A future upstream enhancement request could ask Codex to emit compact boundaries as structured `--json` events, but that is not required for this fix.
