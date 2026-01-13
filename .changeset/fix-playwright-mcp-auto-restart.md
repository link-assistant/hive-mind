---
'@link-assistant/hive-mind': patch
---

Auto-cleanup .playwright-mcp/ folder to prevent false auto-restart triggers

- Add auto-cleanup of .playwright-mcp/ folder before checking uncommitted changes
- Add --playwright-mcp-auto-cleanup option (enabled by default)
- Use --no-playwright-mcp-auto-cleanup to disable cleanup for debugging
- Add comprehensive case study documentation for issue #1124
