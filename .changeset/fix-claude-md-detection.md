---
"@link-assistant/hive-mind": patch
---

Fix CLAUDE.md not being deleted in continue mode

When a work session completes successfully but the CLAUDE.md commit hash was lost between sessions (e.g., due to session interruption), the system now attempts to detect the CLAUDE.md commit from the branch structure instead of silently skipping cleanup.

**Safety Checks (Preventing Issue #617 Recurrence):**
1. CLAUDE.md must exist in current branch
2. Find merge base to isolate PR-only commits
3. Must have at least 2 commits (CLAUDE.md + actual work)
4. First commit message must match expected pattern
5. First commit must ONLY change CLAUDE.md file

Fixes #940
