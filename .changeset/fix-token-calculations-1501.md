---
'@link-assistant/hive-mind': patch
---

fix: correct cost and token/context budget calculations (#1501)

- Deduplicate JSONL session entries by message ID to fix inflated token counts caused by upstream anthropics/claude-code#6805
- Show peak context window usage (max single-request fill) instead of cumulative sum which produced nonsensical percentages like 7516%
- Add "Total tokens processed" as a separate cumulative metric for session throughput visibility
- Add verbose logging for JSONL deduplication stats and peak context values
