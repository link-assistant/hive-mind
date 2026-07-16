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
session forever (or failing outright), it now **repairs the on-disk transcript and resumes
the existing session first** and, only when repair+resume is not possible, **discards the
un-resumable session and restarts fresh**. On every such critical error it also auto-commits
(and best-effort pushes) any uncommitted work first, so nothing is lost when the session
context resets.

> **PR #1836 — "can we do even better?"** The original PR #1835 recovery was _reactive_: a
> plain resume of a poisoned transcript just repeats the 400, so recovery almost always fell
> through to a **fresh restart that discards dozens of turns** of accumulated context (50
> turns / **$3.84** in the second reproduction; 129 turns / $1.66 in the first). This PR adds a
> **proactive transcript repair** (`src/claude.session-transcript-repair.lib.mjs`): before
> resuming, it strips the corrupted empty-text `thinking`/`redacted_thinking` blocks from the
> session JSONL (a workaround proven upstream — the API permits _omitting_ earlier thinking,
> just not _modifying_ it). When repair succeeds the resume **keeps all accumulated context**;
> when it can't help, recovery still falls back to a fresh restart, so there is no regression.

## Issue Details

- **Issue**: [#1834](https://github.com/link-assistant/hive-mind/issues/1834)
- **Title**: API Error: 400 messages.1.content.19: `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified.
- **Labels**: bug
- **Reported**: 2026-05-28
- **Pull Requests**: [#1835](https://github.com/link-assistant/hive-mind/pull/1835) (initial detect + resume-first-then-restart + auto-commit), [#1836](https://github.com/link-assistant/hive-mind/pull/1836) (proactive transcript repair — "can we do even better?")
- **Reproduction logs**:
  - [`reproduction-log.txt`](./reproduction-log.txt) — the full 16,573-line solution-draft log from the issue's gist (`solve v1.73.4`, 129 turns).
  - [`reproduction-log-2.txt`](./reproduction-log-2.txt) — a second 5,932-line `solve v1.73.4` run from the PR #1836 comment gist (50 turns, **$3.84**), which captures the corrupted `"thinking": ""` blocks **live in the stream** (lines 860, 1205) before the final 400 at `messages.1.content.17`.

## Requirements (extracted verbatim from the issue)

The issue body lists the following requirements. Each is addressed in this PR:

1. **Find root cause and fix it.** → [Root Cause](#root-cause-analysis), [The Fix](#the-fix).
2. **Download all logs/data related to the issue into `./docs/case-studies/issue-1834`.** → [`reproduction-log.txt`](./reproduction-log.txt) (copied from the gist) plus this document.
3. **Deep case study analysis** (search online too): reconstruct the timeline, list every requirement, find root cause of each problem, propose solutions/plans, check existing components/libraries. → This document.
4. **If not enough data to find the root cause, add debug output / verbose mode** for the next iteration. → Verbose diagnostics added (request id + content path). See [Diagnostics](#diagnostics--observability).
5. **If the issue belongs to another repo where we can file issues, do so** (with reproducible examples, workarounds, fix suggestions). → The upstream bug is already extensively reported; we link the canonical issues rather than file duplicates. See [Upstream Issues](#upstream-issues-already-filed).
6. **Apply the fix to the entire codebase** — fix in all places where it occurs. → See [Coverage Across the Codebase](#coverage-across-the-codebase).
7. **Plan and execute everything in the single existing PR.** → PR #1835 landed the initial recovery; the "can we do even better?" follow-up (proactive transcript repair) is delivered in PR #1836 on branch `issue-1834-710b1033fbca`.

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

### Second occurrence (`reproduction-log-2.txt`, PR #1836 comment)

A second `solve v1.73.4` run (still **pre-fix**) reproduced the identical failure and, crucially,
captured the **corruption forming live in the stream** — not just the final rejection:

| Time (UTC) | Log line | Event                                                                                                                                               |
| ---------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10:14:26   | 6        | `solve v1.73.4` started (fresh session, no `--resume`).                                                                                             |
| 10:15:00   | 604      | Session `fdc50a04-b97f-4e03-b634-de446f0456b4` begins.                                                                                              |
| 10:15:04   | 860      | A streamed assistant message already contains `"thinking": ""` — an **empty-text thinking block** (with kept signature) persisted into the history. |
| 10:15:17   | 1205     | A second empty `"thinking": ""` block appears — the poison is accumulating early in the conversation.                                               |
| 10:33:37   | 5827     | After 50 turns the request fails: `400 messages.1.content.17 … cannot be modified`.                                                                 |
| 10:33:37   | 5840     | Result event: `subtype: "success"`, `is_error: true`, `api_error_status: 400`, `num_turns: 50`, `total_cost_usd: 3.8426…`.                          |

This run is the direct motivation for PR #1836: the corrupted blocks are **visibly present in the
on-disk transcript** (`"thinking": ""`), which is exactly what the transcript-repair step strips so
the session can resume with its 50 turns of context intact instead of being discarded. Note the
offending block is at `messages.1.content.17` here vs `messages.1.content.19` in log 1 — both are
the **first assistant message** (an early-conversation thinking block), consistent with the
compaction/round-trip root cause.

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

### 2. Recover — `src/claude.thinking-block-recovery.lib.mjs` (wired into `src/claude.lib.mjs`)

`executeClaudeCommand` handles `requiresFreshSession` in both the streamed-result path and
the thrown-exception path via a stateful handler built by
`createThinkingBlockRecovery({ argv, tempDir, branchName, $, log })`. The handler keeps its
resume/restart counters across recursive retries and implements a **two-phase escalation**
(per PR #1835 feedback: _"try resume first, and if not possible try to restart"_):

- **Phase 1 — repair the transcript, then resume (PR #1836).** While
  `resumeCount < retryLimits.maxThinkingBlockResumes` (default **1**) and a session id is known, it
  preserves work, **repairs the on-disk transcript** via
  `repairCorruptedThinkingBlocks({ tempDir, sessionId })` (strips the empty-text
  `thinking`/`redacted_thinking` blocks, backing up the original first), sets
  `argv.resume = sessionId`, waits briefly, and re-enters `executeWithRetry` to **resume the
  existing session**. With the corrupted blocks removed the replayed history is valid, so resume now
  **preserves the accumulated context** (the 50 turns / $3.84 the old behavior would have thrown
  away). If repair finds nothing to fix or resume still fails, the same error re-invokes the handler,
  the resume cap is now exhausted, and it falls through to Phase 2 — so there is **no regression**
  relative to the PR #1835 behavior.
- **Phase 2 — restart fresh.** While `restartCount < retryLimits.maxThinkingBlockRestarts`
  (default **2**), it discards the session (`argv.resume = undefined`) so the next run starts a
  **brand-new** conversation, waits briefly, then re-invokes `executeWithRetry`.
- When both caps are exhausted it returns `false`; the streamed path falls through to the normal
  `commandFailed` return (the 400 is not a transient pattern, so it is not retried) — a
  deterministically reproducing corruption fails cleanly instead of looping forever.

**Auto-commit on every critical error.** Before each resume/restart the handler calls
`preserveWork()`, which (when `criticalErrorRecovery.autoCommitUncommittedChanges` is on,
the default) runs `commitUncommittedChangesOnCriticalError` from
`src/critical-error-commit.lib.mjs` to commit — and best-effort push — any uncommitted changes
so partial work survives the session reset. The same chokepoint in `src/solve.mjs` also
auto-commits whenever a run ends in a critical error (`success === false ||
errorDuringExecution === true`), satisfying PR #1835's _"on all critical errors we auto commit
uncommitted changes by default."_ The helper is dependency-light and **never throws**, so a
failed commit can never mask the original error.

### 2b. Repair the transcript — `src/claude.session-transcript-repair.lib.mjs` (PR #1836)

`repairCorruptedThinkingBlocks({ tempDir, sessionId, homeDir, log })` is the "do better" step. It
resolves the session JSONL (`~/.claude/projects/<cwd-with-/-as-->/<sessionId>.jsonl`, the same path
logic `claude.lib.mjs` already uses for usage stats), parses it line-by-line, and for each assistant
message with an array `content` removes any block that is a corrupted thinking block:

```js
const isCorruptedThinkingBlock = block => {
  if (!block || typeof block !== 'object') return false;
  if (block.type === 'thinking') return !block.thinking; // '' / undefined / null
  if (block.type === 'redacted_thinking') return !block.data;
  return false;
};
```

This mirrors the proven community workaround (e.g.
[anthropics/claude-code#46843](https://github.com/anthropics/claude-code/issues/46843) and the
`claude-code-thinking-blocks-fix` scripts): the API rejects _modified_ thinking blocks but happily
accepts a history where the earlier thinking is simply **omitted**, so deleting the empty-text blocks
makes the transcript replayable again. The implementation is deliberately conservative:

- **Never throws** — every failure path (missing file, unparseable line, write error) returns a
  result object so recovery can still fall back to a fresh restart.
- **Only removes empty-text blocks** — a legitimate signed, non-empty thinking block is left
  byte-identical.
- **Never empties a message** — if stripping would leave an assistant message with an empty `content`
  array (itself an invalid request), that message is left untouched.
- **Backs up first** — writes a one-time `<session>.jsonl.pre-repair-backup` before rewriting, so the
  original poisoned transcript is preserved for forensics.

### 3. Configure — `src/config.lib.mjs`

```js
// Corrupted extended-thinking-block recovery (Issue #1834)
// PR #1835 feedback: try resume first (cap below), then fall back to a fresh restart.
maxThinkingBlockResumes: parseIntWithDefault('HIVE_MIND_MAX_THINKING_BLOCK_RESUMES', 1),
maxThinkingBlockRestarts: parseIntWithDefault('HIVE_MIND_MAX_THINKING_BLOCK_RESTARTS', 2),
```

```js
// PR #1835 feedback: "on all critical errors we auto commit uncommitted changes by default."
export const criticalErrorRecovery = {
  autoCommitUncommittedChanges: getenv('HIVE_MIND_AUTO_COMMIT_ON_CRITICAL_ERROR', 'true').toLowerCase() === 'true',
};
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

Each recovery attempt logs the phase and counter — `Resume attempt N/M …` for Phase 1 and
`Resume not possible — restart N/M with a fresh session` for Phase 2 (including the discarded
session id) — and any auto-commit of preserved work is logged with the staged file list. The
Phase 1 transcript repair logs (verbose) how many corrupted blocks it stripped and the backup path
(`🩹 Repaired session transcript: stripped N corrupted thinking block(s) …`), or why it made no
change (`ℹ️ Transcript repair made no change (<reason>) — resuming as-is`).

## Coverage Across the Codebase

The detection lives in the **single shared classifier** `classifyRetryableError`
(`src/tool-retry.lib.mjs`), which is the one place every tool funnels error strings through.
The recovery is wired into `executeClaudeCommand` (the claude executor) in **both** failure
paths (streamed result and thrown exception). Non-claude tools (codex/gemini/qwen/opencode)
share the classifier; they treat the error as non-retryable exactly as before. No other
call site constructs this error or needs separate handling.

The auto-commit-on-critical-error behavior is similarly centralized: the recovery handler
preserves work before each resume/restart, and `src/solve.mjs`'s single end-of-session
commit chokepoint preserves work whenever any run ends in a critical error — both routed
through the one shared `commitUncommittedChangesOnCriticalError` helper.

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

| Component                                                | Reused for                                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `classifyRetryableError` (`tool-retry.lib.mjs`)          | Single source of truth for error classification; extended with `requiresFreshSession`.                          |
| `retryLimits` + `parseIntWithDefault` (`config.lib.mjs`) | Env-overridable numeric limits, validated/exported like every other limit.                                      |
| `waitWithCountdown` (`tool-retry.lib.mjs`)               | Shared backoff wait (also de-duplicated from `claude.lib.mjs` by this PR).                                      |
| `executeWithRetry` recursion (`claude.lib.mjs`)          | The existing retry loop; resume re-enters with `argv.resume = sessionId`, restart with it cleared.              |
| Session-path logic (mirrors `getModelUsageFromSession`)  | `resolveSessionTranscriptPath` reuses the same `~/.claude/projects/<cwd>/<id>.jsonl` convention for the repair. |
| `solve.mjs` end-of-session commit chokepoint             | Existing auto-commit path, now also triggered on critical errors by default.                                    |
| `reportError` (`sentry.lib.mjs`)                         | Best-effort error reporting from the never-throwing auto-commit helper.                                         |

## Verification

- Unit test: [`tests/test-issue-1834-thinking-block-recovery.mjs`](../../../tests/test-issue-1834-thinking-block-recovery.mjs)
  — **35 assertions** covering detection (exact issue message, `redacted_thinking`, case-insensitive,
  structured-object input), no-false-positives (casual "thinking", unrelated "cannot be
  modified", transient errors unaffected), the resume/restart-cap config, the
  auto-commit-on-critical-error config, the **resume-first-then-restart escalation** (Phase 1
  sets `argv.resume`; Phase 2 clears it; eventual give-up; no-session-id skips resume), the
  `commitUncommittedChangesOnCriticalError` helper (commits+pushes when dirty, no-ops when clean,
  never throws when misconfigured), and — new in PR #1836 — the **transcript repair** (strips an
  empty-text `thinking` block while keeping the rest of the message, removes empty
  `redacted_thinking`, leaves valid signed thinking byte-identical, never empties a message, writes a
  backup, degrades gracefully on a missing transcript / no args) plus the **Phase 1 repair-then-resume
  integration** (repair is invoked before `argv.resume` is set, and a thrown repair never blocks
  recovery).
- Full default test suite passes.
- `npm run lint` and `prettier --check` pass; every source file stays under the 1500-line limit.

## Files Changed

| File                                                | Change                                                                                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/tool-retry.lib.mjs`                            | Detect corrupted-thinking 400 → `requiresFreshSession` (PR #1835).                                                                     |
| `src/claude.lib.mjs`                                | Wire the two-phase recovery into both failure paths; verbose diagnostics; refactors (PR #1835).                                        |
| `src/claude.thinking-block-recovery.lib.mjs`        | Stateful resume-first-then-restart handler; **PR #1836** adds repair-then-resume to Phase 1.                                           |
| `src/claude.session-transcript-repair.lib.mjs`      | **New (PR #1836)** — `repairCorruptedThinkingBlocks`: strips empty-text thinking blocks from the session JSONL (backup + never-throw). |
| `src/critical-error-commit.lib.mjs`                 | Never-throwing `commitUncommittedChangesOnCriticalError` auto-commit helper (PR #1835).                                                |
| `src/config.lib.mjs`                                | `maxThinkingBlockResumes` + `maxThinkingBlockRestarts`; `criticalErrorRecovery` config (PR #1835).                                     |
| `src/solve.mjs`                                     | Auto-commit uncommitted changes when a run ends in a critical error (default on) (PR #1835).                                           |
| `src/claude.budget-stats.lib.mjs`                   | `displaySessionTokenUsage` (extracted from `claude.lib.mjs`) (PR #1835).                                                               |
| `tests/test-issue-1834-thinking-block-recovery.mjs` | Regression test — **35 assertions** (PR #1836 adds the repair + repair-then-resume tests).                                             |
| `docs/case-studies/issue-1834/`                     | This case study + both reproduction logs.                                                                                              |
