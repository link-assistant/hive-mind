---
'@link-assistant/hive-mind': patch
---

Make the repeated-tool-call breaker opt-in (`--detect-repeated-tool-calls` / `HIVE_MIND_DETECT_REPEATED_TOOL_CALLS=true`) with a default limit of 10 (was 3, always on). CI polling commands (`gh pr checks`, `gh run view`, …) are never counted, and failing calls only count as repeated when their output repeats too. The auto-merge loop continues with feedback after a breaker stop instead of reporting a tool failure.

`--auto-merge` now ensures the pull request still links its issue ("Fixes #N") right before merging, restores the link when a later session removed it, and holds the merge back when the link cannot be ensured, so a pull request is never auto-merged unattached to its issue.
