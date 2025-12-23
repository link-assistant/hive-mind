---
'@link-assistant/hive-mind': patch
---

Detect OpenCode permission prompts and recommend @link-assistant/agent for autonomous workflows

- Configure all OpenCode permissions to "allow" (edit, bash, webfetch, skill, doom_loop, external_directory)
- Detect interactive permission prompts that block automated execution
- Recommend @link-assistant/agent (100% unrestricted OpenCode fork) when prompts are detected
