---
'@link-assistant/hive-mind': patch
---

fix: improve context, token and cost estimation accuracy for multi-model sessions (#1508)

- Merge resultModelUsage from Claude Code result JSON into JSONL-based calculations to include sub-agent model tokens (e.g., Haiku) that are missing from JSONL
- Split token and context usage per model in budget stats PR comments
- Show per-model cost breakdown in budget stats
- Fix sub-sessions being duplicated under each model heading in multi-model mode
- Add verbose diagnostics indicating when token data is sourced from result JSON vs JSONL
