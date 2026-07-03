---
"@link-assistant/hive-mind": patch
---

Make live issue/PR event input available for every tool via `--auto-input-until-mergeable` (issue #2007). Claude streams events into the live process through `--input-format stream-json`; every other tool (codex, agent, opencode, gemini, qwen, ...) uses a universal restart/resume fallback that waits for the current turn to finish in the JSON output, stops the process, and resumes the AI session with the new events. Adds issue title/description edit detection as a restart trigger, reworks the capability matrix to report each tool's delivery mode, and links the upstream link-assistant/agent tracking issues for missing native live-streaming features.
