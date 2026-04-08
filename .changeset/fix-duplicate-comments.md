---
'@link-assistant/hive-mind': patch
---

fix: prevent duplicate PR comments via similarity-based deduplication (issue #1495)

Added comment-dedup.lib.mjs with text normalization, similarity scoring, and deduplication logic.
Integrated dedup into auto-merge "Ready to merge" and "Auto-merged" comment posting.
Added AI agent prompt instructions to check for existing similar comments before posting.
Includes case study documentation and 26 unit tests.
