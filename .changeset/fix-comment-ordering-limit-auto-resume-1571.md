---
'@link-assistant/hive-mind': patch
---

fix: prevent solution draft log and ready to merge comments from appearing between limit reached and auto resume (#1571)

- `autoContinueWhenLimitResets()` now awaits child process exit instead of returning immediately after spawn
- Added defense-in-depth guard in solve.mjs to skip post-processing when limit was reached with auto-continue enabled
- This ensures the correct comment ordering: Limit Reached → Auto Resume → Solution Draft Log → Ready to merge
