---
'@link-assistant/hive-mind': patch
---

fix: prevent early exit when --auto-merge flag is used

The `verifyResults()` function was calling `safeExit(0)` before the auto-merge logic could run. This caused the `--auto-merge` flag to be silently ignored. Now the exit condition properly checks for `argv.autoMerge` and `argv.autoRestartUntilMergable` flags.
