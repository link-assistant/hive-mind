---
'@link-assistant/hive-mind': patch
---

fix: extract helper functions from solve.auto-merge.lib.mjs to fix 1500-line limit violation (#1593)

- Extract `checkForExistingComment`, `checkForNonBotComments`, and `getMergeBlockers` into new `solve.auto-merge-helpers.lib.mjs`
- Add warning threshold (1350 lines) to `check-file-line-limits.sh` to flag files approaching the 1500-line limit
- Add case study documenting the concurrent PR merge race condition root cause
