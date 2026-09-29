---
'@link-assistant/hive-mind': patch
---

Keep one-shot Claude Agent, Bash, Workflow and MCP work in the foreground so print mode's 600-second background-task ceiling cannot cancel it. Recognise the ceiling sweep exactly, including local Bash tasks killed at exit, and resume the same session once. Stop subagent cancellations and errors from becoming false "user rejected tool use" failures. Resume failed sessions affected by child OOM events, and report actual recovery outcomes.
