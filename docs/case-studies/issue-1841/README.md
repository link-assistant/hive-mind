# Case Study — Issue #1841: `Prompt is too long`

> **TL;DR** — A headless `solve` run filled Claude Code's 200K-token context window. Claude Code's
> built-in auto-compaction triggered but **failed** (`compact_error: too_few_groups`), so the prompt
> could not be reduced and the next API call returned the synthetic error **`Prompt is too long`**
> (`terminal_reason: blocking_limit`). The process exited 1. **Root cause is on the Claude Code
> side** (a well-documented upstream limitation). On hive-mind's side the failure was treated as a
> generic exit-1 with no graceful recovery. This PR adds **prevention (a per-turn output cap so a
> single turn can't dominate the compaction window) + detection + fresh-session recovery + verbose
> compaction tracing + auto-commit-on-error**, so the run avoids the failure where possible and
> preserves work + continues instead of dying when it can't. See **§4.1** for why lowering the
> compaction _threshold_ alone cannot fix this and what does.

- **Issue:** https://github.com/link-assistant/hive-mind/issues/1841
- **PR:** https://github.com/link-assistant/hive-mind/pull/1842
- **Source log (gist):** [`solution-draft-log-pr-1780093061356.txt`](./raw-data/solution-draft-log-pr-1780093061356.txt) — the failed run that prompted the issue.
- **Failing run target:** `solve https://github.com/link-assistant/formal-ai/pull/346` (a `write_program` Rust task, PR #346 / issue #340).
- **Session id:** `88c9c3b2-a155-4b1b-8a88-afdcffd31beb`

---

## 1. Timeline / sequence of events

Reconstructed from the gist log (all times UTC, 2026-05-29):

| Time                        | Event                                                                                                                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `21:56:24`                  | `solve` starts on `formal-ai` PR #346 (`node … solve …`, model Opus).                                                                                                                                             |
| `21:56:49`                  | Claude session `88c9c3b2…` created; work begins.                                                                                                                                                                  |
| `22:00:04`–`22:00:12`       | Agent repeatedly runs `head`/`awk` against `src/blueprint.js`, which **does not exist** (`Error: Exit code 1 … cannot open 'src/blueprint.js'`). Tool errors and large tool outputs accumulate in the transcript. |
| … (≈ 20 min, **475 turns**) | The transcript grows turn after turn; context creeps toward the 200K window.                                                                                                                                      |
| `22:17:39.346`              | `rate_limit_event` — `status: allowed` (so this is **not** a usage-limit failure).                                                                                                                                |
| `22:17:39.375`              | `system / status: compacting` — Claude Code triggers **auto-compaction** (context near the limit).                                                                                                                |
| `22:17:39.375`              | `system / status: null, compact_result: "failed", compact_error: "too_few_groups"` — **auto-compaction FAILED**.                                                                                                  |
| `22:17:39.378`              | Synthetic `assistant` message `model: "<synthetic>"`, content `"Prompt is too long"`, `error: "invalid_request"`.                                                                                                 |
| `22:17:39.379`              | `result` event: `subtype: "success"` but `is_error: true`, `result: "Prompt is too long"`, `terminal_reason: "blocking_limit"`, final-turn `output_tokens: 125310`, `num_turns: 475`, `total_cost_usd ≈ 3.19`.    |
| `22:17:39.913`              | hive-mind: `❌ Claude command failed with exit code 1`.                                                                                                                                                           |
| `22:17:39.940`              | hive-mind: `📄 Attaching failure logs to Pull Request…` then exits 1.                                                                                                                                             |

**Key signal:** the final assistant turn alone was **~125K output tokens** — a single oversized turn.
Auto-compaction groups the transcript into summarizable chunks; when one turn dominates the window
there are **too few groups** to compact (`too_few_groups`), so compaction cannot shrink the prompt.

### Event flow (the failure mechanism)

```
context window (200000) fills up
        │
        ▼
system status: "compacting"        ← Claude Code auto-compaction kicks in (on by default)
        │
        ▼
compact_result: "failed"           ← compaction REFUSES/FAILS …
compact_error: "too_few_groups"    ← … because one ~125K-token turn dominates the window
        │
        ▼
assistant "<synthetic>": "Prompt is too long"   (error: "invalid_request")
        │
        ▼
result is_error:true, terminal_reason:"blocking_limit"  →  exit 1
```

---

## 2. Requirements from the issue (checklist)

The issue body enumerates the following; each is addressed in this PR:

| #   | Requirement                                                                                                                                                                                              | Status                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Understand the **root cause**; fix it if it's on our side, **report** it if it's on Claude Code's side.                                                                                                  | ✅ Root cause found (Claude Code side). Documented here; upstream issues referenced (see §5).                                                                                      |
| R2  | **Auto-commit** uncommitted changes on such errors (and on all errors by default).                                                                                                                       | ✅ Recovery preserves work before each restart; failure-exit also auto-commits. On by default.                                                                                     |
| R3  | **Download all logs/data** to `./docs/case-studies/issue-1841/` and produce a **deep case study** (timeline, requirements, root causes, solutions, existing-library survey), searching online for facts. | ✅ This document + `raw-data/` + `research-sources.json`.                                                                                                                          |
| R4  | If **not enough data** to find the root cause, add **debug output / verbose mode** to capture it next time.                                                                                              | ✅ Verbose compaction-lifecycle tracing added (`compacting` / `compact_result: failed` / `terminal_reason`).                                                                       |
| R5  | If the issue relates to **another repo** where we can file issues, report there with reproducible examples, workarounds, and code-level fix suggestions.                                                 | ✅ It's a Claude Code limitation; already reported upstream multiple times — filing a new one would duplicate. Draft + references in [`upstream-report.md`](./upstream-report.md). |
| R6  | Apply the fix across the **entire codebase** (fix in all places).                                                                                                                                        | ✅ Detection is centralized in `classifyRetryableError` (shared by all tools); recovery wired into both the result-path and exception-path of `claude.lib.mjs`.                    |
| R7  | Plan and execute everything in the **single PR #1842**.                                                                                                                                                  | ✅ All commits land on `issue-1841-528a4ab747d3`.                                                                                                                                  |

---

## 3. Root-cause analysis

### 3.1 Is it our bug or Claude Code's?

**It is a Claude Code-side limitation.** The error is generated by Claude Code's own auto-compaction
pipeline, not by hive-mind. The chain is entirely inside the Claude Code process:

1. Context window (200000 tokens) is exhausted.
2. Claude Code's **auto-compaction** (on by default) attempts to summarize the transcript using a
   smaller-context summarization model.
3. Compaction **fails** with `too_few_groups`: it cannot form enough summarizable groups because a
   single turn (~125K tokens here) dominates the window.
4. Because the prompt was never reduced, the next request is still over the limit, and Claude Code
   returns the synthetic `Prompt is too long` (`invalid_request`) with `terminal_reason:
blocking_limit`.

Claude Code's official [error reference](https://code.claude.com/docs/en/errors) confirms:

> **Prompt is too long** — The conversation plus attached files exceeds the model's context window.
> **What to do:** Run `/compact` to summarize earlier turns and free space, or `/clear` to start
> fresh. … Auto-compact is on by default and normally prevents this error.

And, crucially for headless mode: _"the run aborts because the transcript only grows and retrying
cannot succeed."_ In non-interactive (`-p`) mode there is **no `/compact` or `/clear` prompt** — so
the only recovery available to an orchestrator is to **discard the session and start fresh**.

This is reported upstream repeatedly (see §5): anthropics/claude-code **#46348** (most relevant),
#23751, #26317, #25620, #24976, #25867, #23047. It is a known regression/limitation where
auto-compaction fails to rescue a near-full context.

### 3.2 Contributing factor on the run itself

The agent got stuck repeatedly probing a non-existent file (`src/blueprint.js`) and producing a very
large final turn (~125K tokens). That single oversized turn is what made compaction impossible
(`too_few_groups`). This is the agent-behavior trigger, but the **hard failure** is the Claude Code
compaction bug — a healthy compaction would have summarized and continued.

### 3.3 Why hive-mind didn't recover (the gap we fix)

Before this PR, `Prompt is too long`:

- did **not** match any branch in `classifyRetryableError` → fell through to the default
  (non-retryable);
- did **not** match the `isTransientError` patterns → no retry;
- was **not** `context_length_exceeded` (that string check at `claude.lib.mjs` exists but the real
  message is `Prompt is too long`) → no special handling;
- ended in the generic `commandFailed` → `exit 1` path.

So the run died with no attempt to preserve context or restart cleanly. The compaction events were
also **invisible** in the logs (no tracing), making the root cause hard to see.

---

## 4. The fix (what this PR changes)

| Area                     | File                                                                                                 | Change                                                                                                                                                                                                                                                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Detection** (R1, R6)   | `src/tool-retry.lib.mjs`                                                                             | New branch in `classifyRetryableError` that flags `Prompt is too long` / `input is too long` with `{ requiresFreshSession: true, isContextLimit: true }`. Centralized → applies to every tool that uses this classifier.                                                                                     |
| **Recovery** (R1)        | `src/claude.context-limit-recovery.lib.mjs` _(new)_                                                  | `createContextLimitRecovery` — a stateful, capped handler that **forces a fresh session** (`argv.resume = undefined`) because resuming the over-long transcript just replays the same prompt. Modeled on the #1834 thinking-block recovery.                                                                  |
| **Wiring** (R6)          | `src/claude.lib.mjs`                                                                                 | Invokes context-limit recovery in **both** the streamed-result path and the thrown-exception path. The thinking-block recovery is now guarded with `!isContextLimit` so the two recoveries don't collide.                                                                                                    |
| **Config** (R1)          | `src/config.lib.mjs`                                                                                 | New `retryLimits.maxContextLimitRestarts` (default **1**, env `HIVE_MIND_MAX_CONTEXT_LIMIT_RESTARTS`) — bounds fresh restarts to avoid an expensive loop.                                                                                                                                                    |
| **Auto-commit** (R2)     | `src/claude.context-limit-recovery.lib.mjs` + existing `critical-error-commit.lib.mjs` / `solve.mjs` | Recovery calls `commitUncommittedChangesOnCriticalError` (commit + push) **before** each restart; the failure-exit chokepoint in `solve.mjs` also auto-commits. Both gated by `criticalErrorRecovery.autoCommitUncommittedChanges` (default **true**).                                                       |
| **Verbose tracing** (R4) | `src/claude.lib.mjs`                                                                                 | Logs the compaction lifecycle: `🗜️ … auto-compacting`, `⚠️ … auto-compaction FAILED (compact_error: …)`, and a `📏 Detected "Prompt is too long" … final_turn_output_tokens=… terminal_reason=…` diagnostic. So next time the root cause is visible directly in the log.                                     |
| **Prevention** (R1)      | `src/config.lib.mjs` (`computeCompactionSafeOutputCap`, applied in `getClaudeEnv`)                   | **Bounds per-turn output** so a single turn cannot dominate the compaction window and cause `too_few_groups`. Caps `CLAUDE_CODE_MAX_OUTPUT_TOKENS` to `floor(window × 0.45)` (fraction `< 0.5` guarantees ≥2 groups fit), with a 32K floor. This is the lever that actually prevents the failure — see §4.1. |
| **Tests**                | `tests/test-issue-1841-context-limit-recovery.mjs` _(new)_                                           | 33 assertions: classification, no-false-positives, routing separation from thinking-block recovery, restart cap, fresh-restart-only behavior, auto-commit-before-restart, and the per-turn output cap math + `getClaudeEnv` integration.                                                                     |

### Why "fresh session" and not "resume"?

In headless mode the on-disk transcript only **grows**. Resuming session `88c9c3b2…` would send the
same ~full transcript again → `Prompt is too long` again, forever. A **fresh** `solve` session
re-reads the issue/PR/branch state from GitHub and git, so it picks up the **already-committed** work
(hence R2's auto-commit is essential) and continues from a small context. The restart is **capped**
(default 1) because if even a fresh session immediately overflows, the issue/PR context itself is too
large and looping won't help.

### Contrast with related recoveries

| Error class                          | Upstream          | Recovery strategy                                                                 |
| ------------------------------------ | ----------------- | --------------------------------------------------------------------------------- |
| Corrupted thinking blocks (#1834)    | claude-code#63147 | **Repair transcript → resume first**, then fresh restart. Context is recoverable. |
| Prompt is too long (#1841)           | claude-code#46348 | **Fresh restart only.** Resuming replays the over-long prompt — never useful.     |
| Transient (overload/503/500/timeout) | —                 | Retry with backoff, **session preserved**.                                        |

---

## 4.1 Can we configure compaction to prevent this? (verified locally)

> **Question (PR review):** _"As I know it is possible to configure compactification in Claude Code,
> can we make the threshold smaller or limit the compactification output to actually reduce the size
> of the summary prompt?"_

**Short answer:** Yes — and we now do, but **not** by lowering the threshold (which the failing run
already did and which did **not** help). The lever that actually prevents `too_few_groups` is
**bounding per-turn output**. Below is what the docs say and what the local Claude Code binary
(**v2.1.157**, the version installed here) actually does.

### The three relevant knobs

| Env var                           | What it controls                                                                | Verified behavior                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | The auto-compaction **threshold** (context usage at which compaction triggers). | In v2.1.157 the effective window is `min(modelContextWindow, max(100000, value))` — clamped to a **minimum of `1e5` (100K)** and a **maximum of `1e6` (1M)**, then capped to the model's window. The settings UI states: _"The actual threshold is the minimum of this setting and your model's maximum context window."_ hive-mind already sets this to **150K** via `--sub-session-size` (default `150k`, Issue #1706). |
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | A percentage override for the trigger point.                                    | Parsed as a float (`testPctOverride`) inside the compaction config. Lower-only in practice; upstream #25867 reports it does **not** reliably prevent the failure. hive-mind derives it from `--sub-session-size`.                                                                                                                                                                                                         |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS`   | The **maximum tokens a single turn may emit**.                                  | Standard Anthropic env var; bounds each assistant turn. **This is the knob that prevents `too_few_groups`** — it limits the size of the largest single group.                                                                                                                                                                                                                                                             |

(All three strings, plus `too_few_groups` / `compact_error`, are present in the installed binary;
the clamp constants `1e5` / `1e6` were read directly from the v2.1.157 binary.)

### Why lowering the _threshold_ alone cannot fix this

The failing run had **already** lowered the threshold:
`CLAUDE_CODE_AUTO_COMPACT_WINDOW=150000` is in the run's env (gist log lines 486–487). It still
failed — because the failure is not about _when_ compaction triggers, it is about _whether the
transcript can be split into ≥2 summarizable groups_. The final turn alone was **125,310 output
tokens** (allowed because `CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000` for Opus 4.8). One ~125K-token turn
inside a 150K window is a single un-splittable group → `too_few_groups`. Triggering compaction
_earlier_ doesn't add groups; the oversized turn is still indivisible. So lowering the threshold (or
the percent override) cannot rescue this case.

### The fix: bound per-turn output relative to the window

`getClaudeEnv` now caps `CLAUDE_CODE_MAX_OUTPUT_TOKENS` at `floor(window × fraction)` with
`fraction = 0.45 < 0.5`, so **at least two groups always fit** in the compaction window (`cap × 2 <
window`). A 32K floor keeps legitimate long answers possible, and the cap never _raises_ a smaller
configured value.

```
window = 150000 (from CLAUDE_CODE_AUTO_COMPACT_WINDOW), model = Opus 4.8
requested CLAUDE_CODE_MAX_OUTPUT_TOKENS = 128000   (what produced the 125K failing turn)
capped   CLAUDE_CODE_MAX_OUTPUT_TOKENS = floor(150000 × 0.45) = 67500
          → 67500 × 2 = 135000 < 150000  → ≥2 groups always fit → no too_few_groups
```

Both knobs are configurable/escapable:

- `HIVE_MIND_MAX_OUTPUT_COMPACTION_FRACTION` (default `0.45`) — set `0` to disable the cap entirely.
- `HIVE_MIND_MIN_OUTPUT_TOKENS` (default `32000`) — the hard floor for the cap.

This is **defense-in-depth**: the cap (prevention) makes `too_few_groups` far less likely, and the
fresh-session recovery (§4) still catches it if it somehow occurs anyway.

### Verified locally

```bash
$ claude --version
2.1.157 (Claude Code)

$ node tests/test-issue-1841-context-limit-recovery.mjs   # 33 passed, 0 failed
  ✅ Caps Opus 4.8 output (128000) to floor(150000 * 0.45) = 67500
  ✅ Capped output leaves room for >=2 groups in the window (cap*2 < window)
  ✅ getClaudeEnv lowers CLAUDE_CODE_MAX_OUTPUT_TOKENS for Opus 4.8 with a 150k window
  …
```

---

## 5. Existing components / libraries surveyed

- **In-repo (reused):**
  - `commitUncommittedChangesOnCriticalError` (`src/critical-error-commit.lib.mjs`) — never-throws
    commit+push helper from #1834. Reused verbatim for R2.
  - `createThinkingBlockRecovery` (`src/claude.thinking-block-recovery.lib.mjs`) — the
    stateful-capped-recovery pattern; the new module mirrors it.
  - `classifyRetryableError` (`src/tool-retry.lib.mjs`) — the single, shared error-classification
    chokepoint; extending it satisfies R6 (one fix, all tools).
- **Claude Code built-ins:** auto-compaction (`compact` / `compact_result` events),
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (threshold; clamped `min(modelWindow, max(100K, value))` in
  v2.1.157), `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (an env override some users try; per upstream #25867 it
  does not reliably prevent the failure). `CLAUDE_CODE_MAX_OUTPUT_TOKENS` (hive-mind already sets
  this) bounds output — the failing run allowed 128K, which permitted the 125K final turn; **this PR
  now caps it to `floor(window × 0.45)` so a single turn can no longer dominate the window** (see
  §4.1).
- **Upstream reports (no new issue filed — would duplicate):**
  - [#46348](https://github.com/anthropics/claude-code/issues/46348) — _fails with "Prompt is too
    long" instead of auto-compacting_ (most relevant; closed as duplicate).
  - [#23751](https://github.com/anthropics/claude-code/issues/23751), [#26317](https://github.com/anthropics/claude-code/issues/26317),
    [#23047](https://github.com/anthropics/claude-code/issues/23047), [#25620](https://github.com/anthropics/claude-code/issues/25620),
    [#24976](https://github.com/anthropics/claude-code/issues/24976), [#25867](https://github.com/anthropics/claude-code/issues/25867) —
    compaction-fails-at-limit variants.

See [`research-sources.json`](./research-sources.json) for the full source list and
[`upstream-report.md`](./upstream-report.md) for the reproducible-report draft.

---

## 6. How to reproduce & verify

**Reproduce the classification + recovery (unit):**

```bash
node tests/test-issue-1841-context-limit-recovery.mjs
```

**Reproduce the original failure shape:** drive `solve` at a task that causes the agent to generate
one enormous turn near the context limit (e.g. repeatedly dumping large files). The log will now show
the `🗜️ auto-compacting` → `⚠️ auto-compaction FAILED (too_few_groups)` → `📏 Detected "Prompt is
too long"` sequence, followed by an auto-commit and a single fresh-session restart.

---

## 7. Follow-ups (out of scope but noted)

- ~~Proactively trim/avoid pathological large turns~~ — **done** in this PR: per-turn output is now
  capped to `floor(window × 0.45)` (§4.1) so a single turn can no longer dominate the compaction
  window.
- Consider further trimming **tool-output bytes fed back** to the model (a different axis: input
  growth rather than output), to reduce overall context pressure.
- Consider passing `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` to compact earlier — but upstream reports
  indicate it is not a reliable fix, so it is not relied upon here.
