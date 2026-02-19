---
'@link-assistant/hive-mind': patch
---

fix: prevent false positive error detection for JSON-structured stderr warnings (Issue #1337)

Claude Code SDK can emit structured JSON log messages to stderr with format `{"level":"warn","message":"..."}`. When these messages contained error-related keywords like "failed", the detection logic incorrectly flagged them as errors.

Added JSON parsing for stderr messages starting with `{`. If the parsed JSON has a `level` field that is not `"error"` or `"fatal"`, the message is treated as a warning (non-error), preserving existing emoji-prefix detection as a fallback.

Also enables `ANTHROPIC_LOG=debug` when running with `--verbose` flag, allowing users to see detailed API request information as suggested by the BashTool pre-flight warning.
