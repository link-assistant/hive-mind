---
'@link-assistant/hive-mind': patch
---

Fix CI/CD false positive for .gitkeep files using positive matching (Issue #1528).

Use consistent positive matching in detect-code-changes.mjs: "Files considered as code changes" now only shows files matching codePattern, so unknown file types like .gitkeep are naturally excluded without explicit exclusion rules. Add 40 unit tests covering the full detection pipeline.
