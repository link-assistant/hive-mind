---
'@link-assistant/hive-mind': patch
---

Add --prompt-architecture-care flag for managing REQUIREMENTS.md and ARCHITECTURE.md files

Adds an optional experimental flag `--prompt-architecture-care` that provides guidance for:
- Managing REQUIREMENTS.md (high-level why/what documentation)
- Managing ARCHITECTURE.md (high-level how documentation)
- TODO.md workflow management for task persistence across sessions

The flag is disabled by default and works with all tools (claude, agent, opencode, codex).
