---
"@link-assistant/hive-mind": patch
---

Fix Playwright MCP availability detection so pending or unavailable server status no longer enables browser automation hints, surface pending status in interactive session comments, and harden Docker verification so Playwright MCP/CLI availability is checked instead of only grepping for a registration.
