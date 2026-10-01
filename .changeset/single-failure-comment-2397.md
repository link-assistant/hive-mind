---
'@link-assistant/hive-mind': patch
---

Post a single failure comment per failure (#2397). The exit handler no longer repeats a failure already reported by the "Log Upload Failed", "Automation stopped" or "Auto-restart limit reached" comment. Codex's "model is not supported when using Codex with a ChatGPT account" is reported as a plan problem with renewal and daemon-update guidance. Logs containing `token => …` or a short known env value are no longer blocked from publication, env tokens are masked in logs, and a blocked publication now names the failed check, rule ids and log block.
