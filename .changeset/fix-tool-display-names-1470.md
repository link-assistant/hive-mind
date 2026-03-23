---
'@link-assistant/hive-mind': patch
---

fix: update tool display names to full official names (Issue #1470)

- Update `getToolDisplayName()` in `src/model-info.lib.mjs` to return full official names: "Anthropic Claude Code", "OpenAI Codex", "OpenCode", "Agent CLI"
- Update usage limit messages in `src/claude.lib.mjs`, `src/codex.lib.mjs`, and `src/agent.lib.mjs` to use full tool names
- Update test assertions in `tests/model-info.test.mjs` and `tests/test-usage-limit.mjs` to match new display names
