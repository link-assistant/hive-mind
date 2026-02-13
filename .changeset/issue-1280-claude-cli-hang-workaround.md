---
'@link-assistant/hive-mind': patch
---

Fix: Add workaround for Claude CLI hanging after completion (Issue #1280)

Claude CLI sometimes hangs indefinitely after sending the result event without closing stdout.
This fix adds a 30-second timeout after receiving the result event. If the stream doesn't close
within that time, the process is forcefully terminated with SIGTERM/SIGKILL.

This is a workaround for an upstream bug in Claude Code CLI:
https://github.com/anthropics/claude-code/issues/25629

The fix ensures that automation workflows using `solve` command don't get stuck waiting for
a process that has already completed its work.
