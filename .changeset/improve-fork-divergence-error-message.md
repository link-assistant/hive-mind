---
'@link-assistant/hive-mind': patch
---

Improve fork divergence error message clarity

- Remove misleading "Option 3: Work without syncing fork (NOT RECOMMENDED)"
- Add new Option 1 for deleting and recreating fork (marked as SIMPLEST)
- Reorder options by simplicity: deletion → auto-resolution → manual resolution
- Move risk warnings inline with relevant options for better context
- Add comprehensive case study documentation in docs/case-studies/issue-972/

This change makes the error message more useful by removing options that were never actually viable and adding the fork deletion option as the cleanest solution for most fork divergence scenarios.
