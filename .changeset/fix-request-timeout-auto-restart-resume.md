---
'@link-assistant/hive-mind': patch
---

fix: auto-restart with --resume on "Request timed out" in --tool claude (Issue #1353)

When Claude CLI encounters a network timeout, it exhausts its own internal retries and emits a synthetic result event: `{"type":"result","is_error":true,"result":"Request timed out","session_id":"..."}`. Previously hive-mind treated this as a fatal failure and exited, losing all session context (conversation history, cached tokens, partially completed work).

This fix detects the timeout pattern and automatically retries with `--resume <session-id>` to preserve the session, using exponential backoff starting at 5 minutes (increasing to max 1 hour) — longer than regular API errors since Claude CLI has already exhausted its own retries before reporting the timeout.
