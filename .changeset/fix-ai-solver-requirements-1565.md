---
'@link-assistant/hive-mind': minor
---

Prevent AI solver from ignoring changed/expanded requirements: include latest reviewer comment verbatim in the continue-mode prompt and add "Scope management" instructions to all prompt variants (claude, opencode, codex, agent) that explicitly prevent scope narrowing when a reviewer expands requirements (#1565).
