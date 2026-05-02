---
"@link-assistant/hive-mind": patch
---

Fix budget stats sub-agent context-fill calculation so cumulative-only rows (e.g. Claude Haiku 4.5 sub-agent calls that never appear in the parent JSONL) use `input + cache_creation` instead of `input + cache_creation + cache_read`. The previous formula double-counted the cached prefix replayed across calls and produced impossible percentages such as `1.2M / 200K (583%)`.
