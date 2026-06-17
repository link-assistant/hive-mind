---
'@link-assistant/hive-mind': patch
---

Treat a Claude Code `pending` Playwright MCP `system.init` status as a normal
still-connecting state instead of a failure (#1901). Claude Code enables Tool
Search by default, so the deferred `mcp__playwright__*` browser tools load on
demand and Claude waits for the connecting server before using them. Hive Mind
no longer aborts the working session on a `pending` status; only a terminal
`failed`/`error` status surfaces a non-blocking diagnostic in the session-start
comment. See `docs/case-studies/issue-1901`.
