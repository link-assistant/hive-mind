---
'@link-assistant/hive-mind': patch
---

fix: add stream startup timeout to detect stuck Claude CLI (Issue #1472/#1475)

Both affected sessions showed ~4.5 hours with zero stdout/stderr from Claude CLI despite a successful API response. Adds a configurable startup timeout (default: 2 minutes, env: HIVE_MIND_STREAM_STARTUP_MS) that force-kills the Claude CLI process if no output is received, preventing indefinite hangs and enabling retry logic.
