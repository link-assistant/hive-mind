---
"@link-assistant/hive-mind": patch
---

Disable noisy Claude Code features for solve runs via merged user settings, subprocess environment variables, and Docker image defaults. Expands the quiet config to also disable fast mode, feedback surveys, mouse tracking, away summaries, Claude attribution (commit/pr), co-authored-by trailer, thinking summaries, and UI animations, sets viewMode to verbose, and caps tool-use concurrency at 4 for deterministic autonomous runs.
