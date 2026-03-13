---
'@link-assistant/hive-mind': patch
---

fix: /merge command no longer falsely fails when latest CI is in progress (Issue #1425)

The `checkBranchCIHealth` function previously queried only `status=completed` runs
to determine if the default branch CI was healthy. When a new commit had an in-progress
CI run, the function returned the previous (now superseded) commit's failure as the
"latest" CI status, causing the merge queue to be blocked with a false positive error.

The fix resolves the actual HEAD SHA of the branch first, then queries CI runs
specifically for that SHA (without a status filter). If the latest commit's runs are
in progress, the function returns `pending: true` (healthy) instead of reporting a
failure from an older commit. The merge queue then proceeds to the existing
`waitForTargetBranchCI` step which correctly waits for those runs to complete.
