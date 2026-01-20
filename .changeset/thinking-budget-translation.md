---
'@link-assistant/hive-mind': minor
---

Add bidirectional translation between --think and --thinking-budget options for Claude Code

**Changes:**

- Add 'off' option to --think values: ['off', 'low', 'medium', 'high', 'max']
- Add --thinking-budget-claude-minimum-version option (default: 2.1.12)
- For Claude Code >= 2.1.12: translate --think to --thinking-budget (off→0, low→8000, medium→16000, high→24000, max→31999)
- For Claude Code < 2.1.12: translate --thinking-budget back to --think thinking keywords
- Both options now coexist and support all Claude Code versions

**Rationale:**
Claude Code v2.1.12+ no longer responds to thinking keywords (think, think hard, ultrathink) because extended thinking is enabled by default. The only way to control thinking budget programmatically is via MAX_THINKING_TOKENS environment variable.

Fixes #1146
