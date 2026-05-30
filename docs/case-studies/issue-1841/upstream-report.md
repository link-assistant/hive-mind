# Upstream report draft — Claude Code: headless auto-compaction dead-ends (`too_few_groups` → `Prompt is too long`, and the `rapid_refill_breaker` → `Autocompact is thrashing`)

> **Status:** NOT filed as a new issue. The bug is already reported multiple times upstream (see
> "Existing reports" below); a new issue would duplicate. This draft is kept for reference and in case
> a maintainer asks for a fresh, self-contained repro. If filing becomes warranted, post to
> https://github.com/anthropics/claude-code/issues after confirming no open duplicate.
>
> Verified against Claude Code **v2.1.158** (strings/constants read from the installed binary).

## Summary

In non-interactive / headless mode (`claude -p` / `--print` with `--output-format stream-json`),
the auto-compaction subsystem has **two** terminal dead-ends an orchestrator cannot recover from
without discarding the session:

1. **`too_few_groups` → `Prompt is too long`.** When the context fills and a single turn dominates
   the window, auto-compaction **fails** with `compact_error: "too_few_groups"`. The prompt is never
   reduced, so the next model call returns a synthetic `Prompt is too long`
   (`error: "invalid_request"`) and the run aborts (`terminal_reason: "blocking_limit"`, exit 1).
2. **`rapid_refill_breaker` → `Autocompact is thrashing`.** When compaction _succeeds_ but the
   context refills to the limit within a few turns (a large file read or tool output), Claude Code
   trips a **rapid-refill breaker** after 3 consecutive rapid refills and aborts with a synthetic
   `Autocompact is thrashing: … Try reading in smaller chunks, or use /clear to start fresh.`
   (`error: "invalid_request"`, `terminal_reason: "rapid_refill_breaker"`).

There is no `/compact` or `/clear` affordance in headless mode, so in both cases the session is
unrecoverable without external intervention.

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

For the second failure mode (`Autocompact is thrashing`):

```jsonc
{ "type": "system", "subtype": "status", "status": "compacting" }            // succeeds…
// … context refills to the limit within ≤3 turns; repeated 3 times …
{ "type": "assistant",
  "message": { "model": "<synthetic>", "content": [{ "type": "text",
    "text": "Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous compact, 3 times in a row. A file being read or a tool output is likely too large for the context window. Try reading in smaller chunks, or use /clear to start fresh." }] },
  "error": "invalid_request" }
{ "type": "result", "subtype": "success", "is_error": true,
  "terminal_reason": "rapid_refill_breaker" }
```

The breaker is gated behind `tengu_auto_compact_rapid_refill_breaker`; the "3 turns / 3 times"
figures are hard-coded constants in v2.1.158 (`nc6 = 3`, `t08 = 3`) with no env/CLI override.

## Root cause (hypothesis)

Auto-compaction groups the transcript into summarizable chunks. When a **single turn dominates** the
window (here ~125K tokens), there are too few groups to compact (`too_few_groups`), so compaction
cannot shrink the prompt — and the request remains over the limit. Auto-compaction (on by default) is
documented to "normally prevent this error," but it does not when the transcript cannot be grouped.

## Reproduction

**`too_few_groups` / `Prompt is too long`:**

1. Run Claude Code headless on a task that induces very large single turns near the context limit
   (e.g. repeatedly reading/echoing large files, or one giant tool-output-heavy turn).
2. Let the context approach the model window.
3. Observe `status: compacting` → `compact_result: failed` (`too_few_groups`) → `Prompt is too long`.

**`rapid_refill_breaker` / `Autocompact is thrashing`:**

1. Run Claude Code headless on a task that repeatedly reads a single very large file or produces a
   large tool output, so each compaction is immediately undone by the next read.
2. After 3 rapid refills (each within 3 turns of the prior compact), observe the synthetic
   `Autocompact is thrashing` message and `terminal_reason: "rapid_refill_breaker"`.

## Impact

- Headless orchestrators (CI bots, autonomous agents) crash with no recovery path. `/compact` and
  `/clear` are interactive-only.

## Workarounds (what consumers can do today)

- **Detect** `Prompt is too long` / `compact_result: failed` **or** `Autocompact is thrashing` /
  `terminal_reason: rapid_refill_breaker` in the stream and **start a fresh session** (equivalent to
  `/clear`); resuming the same session just replays the same over-large transcript/input.
- Preserve work (commit) before discarding the session.
- Bound output via `CLAUDE_CODE_MAX_OUTPUT_TOKENS` (helps `too_few_groups`; does **not** help
  thrashing, which is input-driven — read large files in smaller chunks instead); optionally compact
  earlier via `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (reported unreliable in #25867). Note: compaction is
  **env-only** — there are no compaction-related CLI flags in `claude --help` (v2.1.158).

## Suggested fixes (code-level, for Claude Code)

1. When compaction fails with `too_few_groups`, fall back to a **hard truncation / single-turn
   summarization** of the oversized turn instead of surfacing `Prompt is too long`.
2. In headless mode, **emit a structured, actionable error** (distinct error code) rather than a
   synthetic assistant message, so orchestrators can branch deterministically.
3. Trigger auto-compaction **earlier** (lower default threshold) when a single turn is projected to
   exceed a fraction of the window.
4. For `rapid_refill_breaker`: instead of aborting after 3 rapid refills, **summarize/elide the
   oversized file or tool output** that keeps refilling the window, and/or surface a structured error
   identifying the offending read so an orchestrator can chunk it — rather than a synthetic assistant
   message.

## Existing reports (deduplication)

- https://github.com/anthropics/claude-code/issues/46348 — _fails with "Prompt is too long" instead
  of auto-compacting_ (most relevant; closed as duplicate).
- https://github.com/anthropics/claude-code/issues/23751
- https://github.com/anthropics/claude-code/issues/26317
- https://github.com/anthropics/claude-code/issues/23047
- https://github.com/anthropics/claude-code/issues/25620
- https://github.com/anthropics/claude-code/issues/24976
- https://github.com/anthropics/claude-code/issues/25867
