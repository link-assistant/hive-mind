---
"@link-assistant/hive-mind": patch
---

Fix exit-0-but-incomplete runs being reported as success under docker isolation (#1990). A `solve` run whose AI tool exited 0 while its session was cut off mid-run (e.g. the container ran out of disk) is now registered as a failure instead of a false success: codex requires its paired `turn.started`/`turn.completed` lifecycle, and gemini and qwen now require their terminal `result` event (claude already gated on it). A flagged failure preserves the AI session for a context-preserving retry and returns a non-zero exit so the docker container filesystem is kept for inspection. Disk-exhaustion strings are surfaced only as diagnostics, never as an independent failure gate, to avoid the #1955 echo false positive.
