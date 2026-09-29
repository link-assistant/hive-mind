---
'@link-assistant/hive-mind': patch
---

Keep Claude background work enabled and raise print mode's background-task wait ceiling to 4x Claude Code's default (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=2400000`). When the ceiling still cancels work, recognise the sweep exactly, including local Bash tasks killed at exit, and silently resume the same session up to 5 times (`HIVE_MIND_CLAUDE_INCOMPLETE_TURN_MAX_RESUMES`) with a prompt that names the timeout and the cancelled tasks. Stop subagent cancellations and errors from becoming false "user rejected tool use" failures. Resume failed sessions affected by child OOM events, and report actual recovery outcomes.
