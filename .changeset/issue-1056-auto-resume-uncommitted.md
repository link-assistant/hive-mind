---
"@link-assistant/hive-mind": patch
---

Add experimental `--auto-resume-on-uncommitted-changes` flag (#1056) that complements the existing `--auto-restart-on-uncommitted-changes` by reusing the previous Claude Code session via `--resume <sessionId>` when uncommitted changes are detected, preserving the agent's accumulated context instead of starting a fresh session. The flag is disabled by default. A companion knob, `--auto-resume-on-uncommitted-changes-maximum-context-window-usage` (default 50%), bounds the worst-case peak usage of the usable pre-compaction context (respecting `--sub-session-size`); sessions at or above the threshold, or sessions whose usage cannot be verified, fall back to a fresh run.
