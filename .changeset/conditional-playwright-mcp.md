---
"@link-assistant/hive-mind": patch
---

Make Playwright MCP usage guidelines conditional based on MCP availability

- Add `checkPlaywrightMcpAvailability()` function to detect if Playwright MCP is installed
- Conditionally include Playwright MCP section in Claude system prompt only when MCP is detected
- Integration in both main execution (solve.mjs) and watch mode (solve.watch.lib.mjs)
- Resolves merge conflicts from main branch
