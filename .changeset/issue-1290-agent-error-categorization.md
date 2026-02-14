---
'@link-assistant/hive-mind': patch
---

Fix false error categorization and missing log upload for `--tool agent` auto-restart

- Fix `isUsageLimitError()` "resets" pattern causing false positives when scanning code output
  - Changed from substring match to regex that requires time-like content after "resets"
  - Prevents ordinary English words like "loads a shell and resets" from triggering usage limit detection
- Fix agent fallback pattern matching running after agent successfully recovered from errors
  - Skip fallback when exitCode=0 and agentCompletedSuccessfully to prevent false error detection
- Upload failure logs when auto-restart iteration fails for `--tool agent` with `--attach-logs`
- Add comprehensive tests for false positive scenarios (Issue #1290)
