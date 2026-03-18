---
'@link-assistant/hive-mind': patch
---

Fix missing log upload on tool failure and make HTTP 529 overload error retryable (Issue #1439)

Two fixes:

1. When `--attach-logs` is enabled and the tool execution fails during an auto-restart session, the failure log was not being uploaded to GitHub. Now the log is attached before stopping on both tool execution failure paths.

2. HTTP 529 (Anthropic "Overloaded") errors were not recognized as transient/retryable by the outer retry loop. The code only matched `API Error: 500` + `Overloaded`, but 529 uses `API Error: 529` + `overloaded_error`. Now both 500 and 529 overload errors trigger the retry logic with exponential backoff.
