---
'@link-assistant/hive-mind': patch
---

fix(claude): recover from "Prompt is too long" when auto-compaction fails (#1841)

A headless `solve` run filled Claude Code's 200K-token context window. Claude
Code's built-in auto-compaction triggered (`system status: compacting`) but
**failed** (`compact_result: failed`, `compact_error: too_few_groups` — one
~125K-token turn dominated the window), so the prompt could never be reduced and
the next call returned the synthetic `Prompt is too long` (`invalid_request`,
`terminal_reason: blocking_limit`). The process exited 1 with no recovery. The
root cause is on the Claude Code side (a documented upstream limitation,
anthropics/claude-code#46348 and friends); hive-mind simply had no handling for
it.

A second, closely-related failure mode in the same subsystem is now handled too:
`Autocompact is thrashing` (`terminal_reason: rapid_refill_breaker`), emitted when a
large file read or tool output keeps refilling the context within a few turns of each
compaction so Claude Code trips its rapid-refill breaker. It is the same upstream
limitation and the message itself recommends `/clear` (a fresh session).

`classifyRetryableError` now flags `Prompt is too long` / `input is too long` **and**
`Autocompact is thrashing` / `rapid_refill_breaker` with
`{ requiresFreshSession: true, isContextLimit: true }` (centralized, so every tool
benefits). A new `createContextLimitRecovery`
(`src/claude.context-limit-recovery.lib.mjs`) **discards the session and restarts
fresh** — resuming would replay the same over-long transcript forever — after
auto-committing uncommitted work (on by default,
`HIVE_MIND_AUTO_COMMIT_ON_CRITICAL_ERROR`). Restarts are capped
(`maxContextLimitRestarts`, default 1, `HIVE_MIND_MAX_CONTEXT_LIMIT_RESTARTS`) to
avoid an expensive loop when even a fresh session overflows. The recovery is wired
into both the streamed-result and thrown-exception paths of `claude.lib.mjs`, and
the thinking-block recovery (#1834) is now guarded with `!isContextLimit` so the
two recoveries don't collide.

To guarantee "auto-commit on **all** errors", the `uncaughtException` /
`unhandledRejection` handlers in `src/exit-handler.lib.mjs` now run the interrupt
(auto-commit + push) before cleanup — previously they ran cleanup only and skipped
auto-commit, so a crash could lose uncommitted work. Backward compatibility is
preserved: every change is additive and gated by existing defaults (the `150k`
`--sub-session-size` default is unchanged; compacting earlier stays opt-in).

As prevention (not just recovery), `getClaudeEnv` now **caps per-turn output** so a
single turn can no longer dominate the compaction window and cause `too_few_groups`.
The failing run had already lowered the compaction *threshold*
(`CLAUDE_CODE_AUTO_COMPACT_WINDOW=150000` via `--sub-session-size`) yet still failed,
because one turn emitted 125,310 output tokens (allowed by
`CLAUDE_CODE_MAX_OUTPUT_TOKENS=128000`). Lowering the threshold cannot fix that — only
bounding per-turn output can. `CLAUDE_CODE_MAX_OUTPUT_TOKENS` is now capped to
`floor(window × 0.45)` (fraction `< 0.5` guarantees ≥2 compaction groups fit), with a
32K floor; configurable via `HIVE_MIND_MAX_OUTPUT_COMPACTION_FRACTION` (set `0` to
disable) and `HIVE_MIND_MIN_OUTPUT_TOKENS`.

Verbose tracing of the auto-compaction lifecycle is added (`🗜️ compacting`,
`⚠️ compaction FAILED (compact_error: …)`, a `📏 Detected "Prompt is too long"`
diagnostic with the final-turn output-token count, and a `📏 Capped per-turn output …`
line when the cap is applied), so the root cause is visible in the log next time. A deep
case study and reproducible upstream-report draft live under
`docs/case-studies/issue-1841` (including §0 before/after summary and §4.1 verifying
Claude Code v2.1.158's compaction config against the binary — clamp constants
`cc6=1e5`/`hL4=1e6`, breaker constants `nc6=t08=3`, and the finding that compaction is
env-only with no CLI flags), with 39 assertions in
`tests/test-issue-1841-context-limit-recovery.mjs`.
