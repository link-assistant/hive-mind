---
"@link-assistant/hive-mind": patch
---

Add experimental `--auto-resume-on-uncommitted-changes` flag (#1056) that complements the existing `--auto-restart-on-uncommitted-changes` by reusing the previous Claude Code session via `--resume <sessionId>` when uncommitted changes are detected, preserving the agent's accumulated context instead of starting a fresh session. The flag is disabled by default. A companion knob, `--auto-resume-on-uncommitted-changes-maximum-context-window-usage` (default 50%), bounds the worst-case peak context usage that still allows resuming; sessions above the threshold fall back to a normal restart. Decision logic lives in a new tool-agnostic helper `src/auto-resume-uncommitted.lib.mjs` and is fully covered by `tests/test-auto-resume-uncommitted-1056.mjs` (21 assertions across threshold parsing, multi-model worst-case picking, and the full decision tree).
