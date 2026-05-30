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
`agent` already did). A new shared `formatToolExecutionFailure` helper in
`lib.mjs` builds a self-explanatory message
(`CLAUDE execution failed with API Error: Output blocked by content filtering
policy`), and all failure-display sites — `solve.mjs` (terminal exit, GitHub
failure comment, and the critical-error auto-commit reason),
`solve.auto-merge.lib.mjs`, and `solve.watch.lib.mjs` — now use it. The helper
collapses whitespace, caps the core error length, and never falls back to the
agent's success summary.

The existing auto-commit-on-critical-error path (#1834) is confirmed to run on
the failure exit and is now labeled with the real failure cause. Adds unit and
cross-tool tests and a deep case study in `docs/case-studies/issue-1845`.
