---
'@link-assistant/hive-mind': patch
---

Usage stats improvements for Agent CLI and Claude Code CLI (Issue #1526)

- Fix context window 288% bug by skipping display when peakContextUsage is 0
- Add Agent CLI "Context and tokens usage" section with model/context parsing
- Shorter output format combining context window and output tokens on single line
- Consolidated Total line with cost information
- Sub-sessions use numbered Context window lines directly
