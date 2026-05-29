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

`classifyRetryableError` now flags `Prompt is too long` / `input is too long` with
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

Verbose tracing of the auto-compaction lifecycle is added (`🗜️ compacting`,
`⚠️ compaction FAILED (compact_error: …)`, and a `📏 Detected "Prompt is too long"`
diagnostic with the final-turn output-token count), so the root cause is visible in
the log next time. A deep case study and reproducible upstream-report draft live
under `docs/case-studies/issue-1841`, with 22 new assertions in
`tests/test-issue-1841-context-limit-recovery.mjs`.
