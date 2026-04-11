---
'@link-assistant/hive-mind': minor
---

fix: interactive mode GitHub comments display improvements (#1576)

- Fix agent task comments stuck at "⏳ Running..." by propagating taskId through comment queue
- Fix misleading token counts by preferring modelUsage (cumulative per-model) over usage (last-iteration)
- Change truncation format from "[N lines truncated]" to "[X-Y lines are omitted]" showing actual line range
- Rename "Session Complete" to "Interactive session completed"
- Rename Write tool "Content" to "Change", expand by default, add line numbers to diffs
- Show checked/total count in TodoWrite: "Todos (2/9 items)" instead of "Todos (9 items)"
- Make Task prompt and Edit Change sections expanded by default
- Add ToolSearch-specific display with Query/Max Results fields
- Mark sub-agent tasks with 🤖🔀 emoji and Agent ID field
- Add queue flushing before waiting for comment IDs in task progress/notification handlers
