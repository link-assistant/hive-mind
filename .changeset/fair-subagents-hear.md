---
"@link-assistant/hive-mind": patch
---

Add `--sub-agent-model` for Claude Code subagents and agent teams. The option is accepted by solve, hive, and Telegram command parsing, validates Claude aliases/full IDs plus `inherit`, and maps to `CLAUDE_CODE_SUBAGENT_MODEL` only when explicitly provided so Claude Code defaults remain unchanged.
