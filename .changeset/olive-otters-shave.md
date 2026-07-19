---
'@link-assistant/hive-mind': patch
---

Stop leaking `CLAUDE_CODE_EFFORT_LEVEL` from the parent shell into the Claude process (issue #2082). `getClaudeEnv()` builds the child environment from `process.env` and sanitised an inherited `MAX_THINKING_TOKENS`, but not the effort level, so any path that computed no level passed the parent's value through — giving `haiku` an effort level it does not support, and `--think off` one despite thinking being disabled. Since Claude Code exports this variable, the leak applied whenever hive-mind ran under it. The emitted effort level is now a function of the selected model and think level only. Linting now also covers the `tests/` tree, which was previously excluded from `npm run lint`.
