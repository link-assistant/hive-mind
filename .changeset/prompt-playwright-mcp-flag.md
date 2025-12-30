---
'@link-assistant/hive-mind': minor
---

Add `--prompt-playwright-mcp` flag to control Playwright MCP hints in system prompt

Users can now explicitly control whether Playwright MCP browser automation hints appear in the AI's system prompt:

- Use `--no-prompt-playwright-mcp` to disable hints even when Playwright MCP is installed
- Use `--prompt-playwright-mcp` to explicitly enable hints
- Omit the flag to keep the default auto-detection behavior
