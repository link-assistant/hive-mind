---
'@link-assistant/hive-mind': patch
---

Make the repeated-tool-call breaker opt-in (`--detect-repeated-tool-calls` / `HIVE_MIND_DETECT_REPEATED_TOOL_CALLS=true`) with a default limit of 10 (was 3, always on). CI polling commands (`gh pr checks`, `gh run view`, …) are never counted, and failing calls only count as repeated when their output repeats too. The auto-merge loop continues with feedback after a breaker stop instead of reporting a tool failure.
