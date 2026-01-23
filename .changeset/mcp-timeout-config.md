---
'@link-assistant/hive-mind': minor
---

feat(solve): configure MCP_TIMEOUT and MCP_TOOL_TIMEOUT for claude tool calls

Added MCP timeout configuration to prevent tool calls from hanging indefinitely:

- Added `mcpTimeout` config (default: 900000ms / 15 minutes) for MCP server startup
- Added `mcpToolTimeout` config (default: 900000ms / 15 minutes) for MCP tool execution
- Support for override via `MCP_TIMEOUT`/`HIVE_MIND_MCP_TIMEOUT` and `MCP_TOOL_TIMEOUT`/`HIVE_MIND_MCP_TOOL_TIMEOUT` environment variables
- Updated `getClaudeEnv()` to pass both timeout values to Claude CLI
- Added verbose logging for MCP timeout values

Fixes #1066
