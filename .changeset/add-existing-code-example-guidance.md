---
'@link-assistant/hive-mind': patch
---

Add system prompt guidance to prefer using existing code as examples

- Added guideline to encourage searching for similar existing implementations before implementing from scratch
- Applied consistently across all three prompt modules (claude, codex, opencode)
- Helps maintain consistency with existing patterns and reduces redundant work
