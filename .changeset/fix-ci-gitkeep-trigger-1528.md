---
'@link-assistant/hive-mind': patch
---

Fix CI/CD triggering on .gitkeep files (Issue #1528).

Add `paths-ignore` for `.gitkeep` to the `pull_request` workflow trigger to prevent creating workflow runs for `.gitkeep`-only pushes. Re-add `.gitkeep` exclusion in `isExcludedFromCodeChanges()` so `.gitkeep` files don't appear in the "Files considered as code changes" list. Export change detection functions for testing and add 29 unit tests.
