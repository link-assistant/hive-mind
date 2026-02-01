---
'@link-assistant/hive-mind': minor
---

feat: add --auto-restart-on-non-updated-pull-request-description option (Issue #1162)

When using `--tool agent` mode, the pull request title and description could remain
in their initial WIP placeholder state. This adds an opt-in `--auto-restart-on-non-updated-pull-request-description`
flag that detects placeholder content after agent execution and auto-restarts with a
short factual hint. Also adds gentle checklist suggestions to agent/opencode/codex prompts
(excluding Claude, which handles PR updates naturally).
