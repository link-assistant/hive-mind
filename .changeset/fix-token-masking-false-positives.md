---
'@link-assistant/hive-mind': patch
---

Fix false positives in token masking for log sanitization

- Remove overly broad regex pattern that was matching legitimate identifiers like `browser_take_screenshot` and MCP tool names
- Add allowlist of safe token patterns (browser\_, mcp\_\_, function names with underscores, UUIDs)
- Add context-aware detection for 40-char hex strings to avoid masking git commit hashes and gist IDs
- Export new helper functions `isSafeToken` and `isHexInSafeContext` for testing
- Add comprehensive unit tests for false positive prevention
