---
'@link-assistant/hive-mind': patch
---

Fix error detection for `--tool agent` when JSON errors are pretty-printed (Issue #1258)

- Add fallback pattern matching for error events when NDJSON parsing fails
- Detect `"type": "error"` and `"type": "step_error"` patterns in raw output
- Detect critical error patterns like `AI_RetryError` and `UnhandledRejection`
- Extract error messages from output for better error reporting
