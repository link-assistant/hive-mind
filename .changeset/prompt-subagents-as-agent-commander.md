---
'@link-assistant/hive-mind': minor
---

Add `--prompt-subagents-via-agent-commander` option to guide Claude to use agent-commander CLI for subagent delegation instead of native Task tool. This allows using any supported agent type (claude, opencode, codex, agent) with a unified API and saves main agent context. The prompt guidance is only included when agent-commander (start-agent) is actually installed on the system.
