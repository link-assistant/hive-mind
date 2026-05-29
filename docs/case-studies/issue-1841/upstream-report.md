# Upstream report draft — Claude Code: auto-compaction fails (`too_few_groups`) → `Prompt is too long` in headless mode

> **Status:** NOT filed as a new issue. The bug is already reported multiple times upstream (see
> "Existing reports" below); a new issue would duplicate. This draft is kept for reference and in case
> a maintainer asks for a fresh, self-contained repro. If filing becomes warranted, post to
> https://github.com/anthropics/claude-code/issues after confirming no open duplicate.

## Summary

In non-interactive / headless mode (`claude -p` / `--print` with `--output-format stream-json`),
when the context window fills, Claude Code's auto-compaction can **fail** with
`compact_error: "too_few_groups"`. Because the prompt is never reduced, the very next model call
returns a synthetic `Prompt is too long` (`error: "invalid_request"`) and the run aborts
(`terminal_reason: "blocking_limit"`, exit code 1). There is no `/compact` or `/clear` affordance in
headless mode, so the session is unrecoverable without external intervention.

## Environment

- Claude Code CLI, headless mode (`-p`, `--output-format stream-json`), model: Opus.
- Long autonomous run (475 turns, ~21 minutes), one final assistant turn ≈ **125,310 output tokens**.

## Observed event sequence (from `stream-json`)

```jsonc
{ "type": "rate_limit_event", "rate_limit_info": { "status": "allowed", … } }   // not a usage limit
{ "type": "system", "subtype": "status", "status": "compacting" }
{ "type": "system", "subtype": "status", "status": null,
  "compact_result": "failed", "compact_error": "too_few_groups" }
{ "type": "assistant",
  "message": { "model": "<synthetic>", "content": [{ "type": "text", "text": "Prompt is too long" }] },
  "error": "invalid_request" }
{ "type": "result", "subtype": "success", "is_error": true,
  "result": "Prompt is too long", "terminal_reason": "blocking_limit",
  "num_turns": 475, "usage": { "output_tokens": 125310 } }
```

## Root cause (hypothesis)

Auto-compaction groups the transcript into summarizable chunks. When a **single turn dominates** the
window (here ~125K tokens), there are too few groups to compact (`too_few_groups`), so compaction
cannot shrink the prompt — and the request remains over the limit. Auto-compaction (on by default) is
documented to "normally prevent this error," but it does not when the transcript cannot be grouped.

## Reproduction

1. Run Claude Code headless on a task that induces very large single turns near the context limit
   (e.g. repeatedly reading/echoing large files, or one giant tool-output-heavy turn).
2. Let the context approach the model window.
3. Observe `status: compacting` → `compact_result: failed` (`too_few_groups`) → `Prompt is too long`.

## Impact

- Headless orchestrators (CI bots, autonomous agents) crash with no recovery path. `/compact` and
  `/clear` are interactive-only.

## Workarounds (what consumers can do today)

- **Detect** `Prompt is too long` / `compact_result: failed` in the stream and **start a fresh
  session** (equivalent to `/clear`); resuming the same session just replays the over-long prompt.
- Preserve work (commit) before discarding the session.
- Bound output via `CLAUDE_CODE_MAX_OUTPUT_TOKENS`; optionally compact earlier via
  `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (reported unreliable in #25867).

## Suggested fixes (code-level, for Claude Code)

1. When compaction fails with `too_few_groups`, fall back to a **hard truncation / single-turn
   summarization** of the oversized turn instead of surfacing `Prompt is too long`.
2. In headless mode, **emit a structured, actionable error** (distinct error code) rather than a
   synthetic assistant message, so orchestrators can branch deterministically.
3. Trigger auto-compaction **earlier** (lower default threshold) when a single turn is projected to
   exceed a fraction of the window.

## Existing reports (deduplication)

- https://github.com/anthropics/claude-code/issues/46348 — _fails with "Prompt is too long" instead
  of auto-compacting_ (most relevant; closed as duplicate).
- https://github.com/anthropics/claude-code/issues/23751
- https://github.com/anthropics/claude-code/issues/26317
- https://github.com/anthropics/claude-code/issues/23047
- https://github.com/anthropics/claude-code/issues/25620
- https://github.com/anthropics/claude-code/issues/24976
- https://github.com/anthropics/claude-code/issues/25867
