# Case Study: Issue #1834 — `thinking`/`redacted_thinking` blocks cannot be modified (400)

## Overview

This case study documents the root-cause analysis and fix for a `400` error that
permanently kills a Claude Code session in the middle of solving an issue:

```
API Error: 400 messages.1.content.19: `thinking` or `redacted_thinking` blocks in the
latest assistant message cannot be modified. These blocks must remain as they were in
the original response.
```

The error is **not** a Hive Mind logic bug — it is an upstream Claude Code / Anthropic
API bug ([anthropics/claude-code#63147](https://github.com/anthropics/claude-code/issues/63147)).
Hive Mind's contribution is **detection and recovery**: instead of resuming a poisoned
session forever (or failing outright), it now discards the un-resumable session and
restarts fresh.

## Issue Details

- **Issue**: [#1834](https://github.com/link-assistant/hive-mind/issues/1834)
- **Title**: API Error: 400 messages.1.content.19: `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified.
- **Labels**: bug
- **Reported**: 2026-05-28
- **Pull Request**: [#1835](https://github.com/link-assistant/hive-mind/pull/1835)
- **Reproduction log**: [`reproduction-log.txt`](./reproduction-log.txt) (the full 16,573-line solution-draft log from the issue's gist)

## Requirements (extracted verbatim from the issue)

The issue body lists the following requirements. Each is addressed in this PR:

1. **Find root cause and fix it.** → [Root Cause](#root-cause-analysis), [The Fix](#the-fix).
2. **Download all logs/data related to the issue into `./docs/case-studies/issue-1834`.** → [`reproduction-log.txt`](./reproduction-log.txt) (copied from the gist) plus this document.
3. **Deep case study analysis** (search online too): reconstruct the timeline, list every requirement, find root cause of each problem, propose solutions/plans, check existing components/libraries. → This document.
4. **If not enough data to find the root cause, add debug output / verbose mode** for the next iteration. → Verbose diagnostics added (request id + content path). See [Diagnostics](#diagnostics--observability).
5. **If the issue belongs to another repo where we can file issues, do so** (with reproducible examples, workarounds, fix suggestions). → The upstream bug is already extensively reported; we link the canonical issues rather than file duplicates. See [Upstream Issues](#upstream-issues-already-filed).
6. **Apply the fix to the entire codebase** — fix in all places where it occurs. → See [Coverage Across the Codebase](#coverage-across-the-codebase).
7. **Plan and execute everything in the single existing PR #1835.** → All work is on branch `issue-1834-60cf8031f181`.

## Timeline / Sequence of Events

Reconstructed from [`reproduction-log.txt`](./reproduction-log.txt):

| Time (UTC)  | Log line   | Event                                                                                                                                                                                      |
| ----------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 21:14:07    | 1          | `solve v1.73.4` started for `https://github.com/digitalstructures/nobr/issues/1` with `--model opus --tool claude --attach-logs --verbose`.                                                |
| 21:14:08    | 8          | Raw command: `solve … --model opus --tool claude --attach-logs --verbose --no-tool-check --disable-report-issue --language en`. **No `--resume` flag — this is a fresh session.**          |
| 21:14:47    | 630        | First `session_id: dfdae9aa-60de-4333-bb25-11399ef4eabc` appears. A single Claude Code session runs from here on.                                                                          |
| 21:14–21:19 | 630–16,390 | Claude Code runs its **own internal agentic loop** — 129 turns, ~5 min wall-clock, ~9.2 min of API time, building a large message history with interleaved `thinking` + `tool_use` blocks. |
| 21:19:47    | 16,400     | `POST /v1/messages?beta=true` → **`400` in 280 ms; `x-should-retry: false`** (request id `req_011CbVfZ3PnFwVTwDXLGCBuW`).                                                                  |
| 21:19:47    | 16,458     | Error text: ``thinking` or `redacted_thinking` blocks … cannot be modified``, at `messages.1.content.19`.                                                                                  |
| 21:19:47    | 16,470     | Result event: `subtype: "success"`, **`is_error: true`**, `api_error_status: 400`, `num_turns: 129`, `stop_reason: "stop_sequence"`, `total_cost_usd: 1.6564625`.                          |
| 21:19:47    | end        | Old behavior prints `💡 To continue this session: claude --resume dfdae9aa…` — i.e. it points the user/automation at the **already-poisoned** session, which can never succeed.            |

### Key observations

- The failure happened **inside a single, fresh Claude Code invocation** (no Hive Mind
  `--resume`), at turn **129**. The corruption was produced by Claude Code's _own_
  internal conversation/compaction management — not by anything Hive Mind sent.
- `messages.1.content.19` = the **first assistant message**, 20th content block — a
  `thinking` block emitted early in the conversation. Once that block is corrupt, **every**
  request that replays the history fails, so the session is dead.
- The result is reported as `subtype: "success"` with `is_error: true`. A naive check of
  `subtype` alone would treat this as a success; Hive Mind correctly keys on `is_error` /
  `api_error_status`.
- `x-should-retry: false` — the API itself says this is not retryable. Retrying with the
  same history (resume) is futile.

## Root Cause Analysis

### Upstream root cause (Claude Code / Anthropic API)

Extended thinking responses contain `thinking` (or `redacted_thinking`) blocks with an
opaque **`signature`** that cryptographically commits to the block's text. When such a
block is later sent back to the API as part of the conversation history, the API verifies
that the block is **byte-for-byte identical** to what the model originally produced. If the
text changed but the signature did not (or vice versa), the API rejects the request with:

> `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be
> modified. These blocks must remain as they were in the original response.

Claude Code corrupts these blocks in at least two known ways:

1. **Transcript round-trip** (canonical, [#63147](https://github.com/anthropics/claude-code/issues/63147)):
   when a session is rebuilt from its on-disk transcript, the thinking text is persisted/restored
   as empty (`""`) while the original `signature` is kept. The signature no longer matches the
   (now empty) text → permanent `400` on resume.
2. **Auto-compaction** ([#12362](https://github.com/anthropics/claude-code/issues/12362),
   [#13012](https://github.com/anthropics/claude-code/issues/13012)): when a long session is
   auto-compacted mid-run, the compaction step rewrites/relocates earlier assistant messages,
   modifying a thinking block that the API then rejects (`messages.N.content.M`).

The reproduction here is a **129-turn single run** that almost certainly hit the
auto-compaction path: the offending block is `messages.1.content.19` (very early in the
conversation), which is exactly what a compaction of the oldest turns would disturb.

Either way, the block can never be reconstructed into a valid form, so the session is
**permanently un-resumable**. The only recovery is a brand-new conversation (equivalent to
`/clear`).

### Why Hive Mind made it worse (the controllable part)

Before this fix, Hive Mind treated the failure like any other terminal error:

- It did **not** recognize the specific 400, so it fell through its error handling and
  printed `To continue this session: claude --resume <id>` — steering retries/users back to
  the dead session.
- In flows that auto-resume (`--resume`, continue mode), replaying the poisoned transcript
  reproduces the same `400` every time — a guaranteed-to-fail loop with no progress.

Hive Mind cannot fix the upstream corruption, but it **can** stop resuming a session that
can never succeed and instead start fresh. That is the fix.

## The Fix

Three small, surgical changes (plus a refactor to respect the 1500-line file limit):

### 1. Detect the error — `src/tool-retry.lib.mjs`

`classifyRetryableError` gains a branch that flags the corrupted-thinking 400 with a new
`requiresFreshSession: true` marker. Crucially it is **not** marked `isRetryable: true`
(which would resume the same dead session), and the branch is placed before the generic
500/503 branches so it cannot be misclassified:

```js
if ((lower.includes('thinking') || lower.includes('redacted_thinking')) && lower.includes('cannot be modified')) {
  return { message, isRetryable: false, isCapacity: false, requiresFreshSession: true, label: 'Corrupted thinking blocks (un-resumable session)' };
}
```

Keeping `isRetryable: false` is deliberate: `classifyRetryableError` is shared by the
codex/gemini/qwen/opencode/agent tools, and only the claude executor knows how to act on
`requiresFreshSession`. Other tools simply see a non-retryable error (their previous
behavior — no regression).

### 2. Recover — `src/claude.lib.mjs`

`executeClaudeCommand` handles `requiresFreshSession` in both the streamed-result path and
the thrown-exception path via a shared helper `tryFreshSessionRestart`, which:

- discards the session (`argv.resume = undefined`) so the next run starts a **brand-new**
  conversation,
- waits briefly, then re-invokes `executeWithRetry`,
- is capped by `retryLimits.maxThinkingBlockRestarts` (default **2**) so a deterministically
  reproducing corruption fails cleanly instead of looping forever.

When the cap is reached, the streamed path falls through to the normal `commandFailed`
return (the 400 is not a transient pattern, so it is not retried).

### 3. Configure — `src/config.lib.mjs`

```js
// Corrupted extended-thinking-block recovery (Issue #1834)
maxThinkingBlockRestarts: parseIntWithDefault('HIVE_MIND_MAX_THINKING_BLOCK_RESTARTS', 2),
```

### Refactor (keep `claude.lib.mjs` ≤ 1500 lines)

`claude.lib.mjs` was already at the repository's hard 1500-line limit (enforced by both
ESLint `max-lines` and `scripts/check-file-line-limits.sh`). To make room for the fix
without exceeding it:

- the local `waitWithCountdown` copy was removed in favor of the shared one already exported
  from `tool-retry.lib.mjs`; and
- the ~60-line token-usage summary block was extracted into
  `claude.budget-stats.lib.mjs` as `displaySessionTokenUsage` (that module already owns the
  per-model display helpers and already imports from `claude.lib.mjs`).

## Diagnostics / Observability

Per requirement #4, verbose diagnostics were added so future occurrences are easy to confirm
from logs. When the error is detected in the streamed-result path, Hive Mind logs (verbose):

```
🧠 Detected corrupted thinking-block error (un-resumable session).
   request_id=<id>, at=messages.N.content.M.
   Will discard the session and restart fresh (Issue #1834, upstream anthropics/claude-code#63147).
```

and each restart logs the discarded session id and the restart counter.

## Coverage Across the Codebase

The detection lives in the **single shared classifier** `classifyRetryableError`
(`src/tool-retry.lib.mjs`), which is the one place every tool funnels error strings through.
The recovery is wired into `executeClaudeCommand` (the claude executor) in **both** failure
paths (streamed result and thrown exception). Non-claude tools (codex/gemini/qwen/opencode)
share the classifier; they treat the error as non-retryable exactly as before. No other
call site constructs this error or needs separate handling.

## Upstream Issues (already filed)

This is a widely-reported upstream bug; filing another duplicate would add noise. The
canonical and most relevant reports:

- **[anthropics/claude-code#63147](https://github.com/anthropics/claude-code/issues/63147)** —
  _Resuming an extended-thinking session fails permanently with 400 "thinking blocks cannot be
  modified" (transcript stores thinking text as empty but keeps signature)_. This is the exact
  root cause described above.
- [#12362](https://github.com/anthropics/claude-code/issues/12362) — thinking blocks modified during **compaction**.
- [#13012](https://github.com/anthropics/claude-code/issues/13012) — API issue during **auto-compact** (`messages.3.content.91`).
- [#10199](https://github.com/anthropics/claude-code/issues/10199), [#12225](https://github.com/anthropics/claude-code/issues/12225) — 400 thinking-block modification error.
- [#20938](https://github.com/anthropics/claude-code/issues/20938), [#20954](https://github.com/anthropics/claude-code/issues/20954), [#22278](https://github.com/anthropics/claude-code/issues/22278), [#25361](https://github.com/anthropics/claude-code/issues/25361), [#63072](https://github.com/anthropics/claude-code/issues/63072) — further duplicates / variants (Write ops, etc.).

### Workaround (for users hitting this manually)

Start a fresh session (`/clear` in interactive Claude, or a new `solve` run without
`--resume`). The corrupted on-disk session cannot be recovered. Hive Mind now does this
automatically.

## Existing Components / Libraries Reused

The fix intentionally reuses Hive Mind's existing retry/recovery infrastructure rather than
adding new machinery:

| Component                                                | Reused for                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `classifyRetryableError` (`tool-retry.lib.mjs`)          | Single source of truth for error classification; extended with `requiresFreshSession`. |
| `retryLimits` + `parseIntWithDefault` (`config.lib.mjs`) | Env-overridable numeric limits, validated/exported like every other limit.             |
| `waitWithCountdown` (`tool-retry.lib.mjs`)               | Shared backoff wait (also de-duplicated from `claude.lib.mjs` by this PR).             |
| `executeWithRetry` recursion (`claude.lib.mjs`)          | The existing retry loop; the fresh restart re-enters it with `argv.resume` cleared.    |
| `claude.budget-stats.lib.mjs`                            | Home for the extracted `displaySessionTokenUsage`.                                     |

## Verification

- New unit test: [`tests/test-issue-1834-thinking-block-recovery.mjs`](../../../tests/test-issue-1834-thinking-block-recovery.mjs)
  — 14 assertions covering detection (exact issue message, `redacted_thinking`, case-insensitive,
  structured-object input), no-false-positives (casual "thinking", unrelated "cannot be
  modified", transient errors unaffected), and the restart-cap config.
- Full default test suite passes (223 test files).
- `npm run lint` and `prettier --check` pass; `claude.lib.mjs` is back under 1500 lines.

## Files Changed

| File                                                | Change                                                                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/tool-retry.lib.mjs`                            | Detect corrupted-thinking 400 → `requiresFreshSession`.                          |
| `src/claude.lib.mjs`                                | Fresh-session recovery in both failure paths; verbose diagnostics; refactors.    |
| `src/config.lib.mjs`                                | `maxThinkingBlockRestarts` (`HIVE_MIND_MAX_THINKING_BLOCK_RESTARTS`, default 2). |
| `src/claude.budget-stats.lib.mjs`                   | New `displaySessionTokenUsage` (extracted from `claude.lib.mjs`).                |
| `tests/test-issue-1834-thinking-block-recovery.mjs` | New regression test.                                                             |
| `docs/case-studies/issue-1834/`                     | This case study + the full reproduction log.                                     |
