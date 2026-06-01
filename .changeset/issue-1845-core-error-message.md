---
'@link-assistant/hive-mind': patch
---

fix(solve): surface the core tool error instead of bare `CLAUDE execution failed` (#1845)

When an AI tool run failed, both the terminal and the posted GitHub
`🚨 Solution Draft Failed` comment showed only the generic
`CLAUDE execution failed`, even though the underlying tool had reported a
specific cause (for example `API Error: Output blocked by content filtering
policy`). The real message was captured inside the tool runner but dropped at
the failure-return boundary, so no downstream consumer could display it.

Every AI tool runner now surfaces a structured `errorInfo` (with a `.message`)
on its failure returns (`claude`, `gemini`, `opencode`, `qwen`; `codex` and
`agent` already did). Two shared helpers in `lib.mjs` — `extractToolErrorCore`
(the core error string) and `formatToolExecutionFailure` (the full
`CLAUDE execution failed with API Error: Output blocked by content filtering
policy` message) — share one precedence so every surface stays consistent.
All failure sites now use them: `solve.mjs` (terminal exit, GitHub failure
comment, critical-error auto-commit reason), `solve.auto-merge.lib.mjs` and
`solve.watch.lib.mjs` (GitHub message + new terminal `Error details:` lines),
and `review.mjs`. The helpers collapse whitespace, cap the core error length,
and never fall back to the agent's success summary.

`isApiError` in `solve.restart-shared.lib.mjs` now classifies through the same
extractor, so a Claude `API Error:` reported via `errorInfo` (never `result`)
is detected and watch mode's `MAX_API_ERROR_RETRIES` backoff guard keeps
working instead of retrying forever.

The auto-commit-on-critical-error path (#1834) is confirmed to run on the
failure exit and is now labeled with the real failure cause; the same guarded
auto-commit is also added to `handleFailure()` so the `uncaughtException`,
`unhandledRejection`, and top-level-catch exits preserve uncommitted work too.
Adds unit, cross-tool, auto-commit, and `isApiError` tests plus a deep case
study in `docs/case-studies/issue-1845`.
