---
'@link-assistant/hive-mind': minor
---

Recognize subscription/account access blocks from every supported CLI (Claude, Codex, Qwen, Gemini, opencode) as their own error class: stop the run instead of retrying or switching model, auto-commit and push the in-flight work first, report what happened and what to do in the terminal, in the `/solve` exit message and in the Telegram completion message (en/ru/zh/hi), and stop the `/hive` queue so the fleet no longer rediscovers the block once per issue.
