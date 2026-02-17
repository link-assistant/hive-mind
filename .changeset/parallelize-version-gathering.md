---
'@link-assistant/hive-mind': patch
---

Parallelize version gathering with Promise.all for 6-30x performance improvement

- Replaced sequential `execSync` calls with parallel `execAsync` using `Promise.all`
- Reduced execution time from 30-150s to ~2-5s for version info gathering
- Added support for all `--tool` options: agent, codex, opencode, qwen-code, gemini, copilot
- Reorganized Telegram output to group tools by programming language instead of generic categories
- Consolidated hive-mind version display to show single version with restart warning when process version differs from installed
- Added `gatherTimeMs` metric to track performance
