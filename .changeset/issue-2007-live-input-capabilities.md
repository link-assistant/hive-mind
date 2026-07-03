---
"@link-assistant/hive-mind": patch
---

Make live issue/PR event input available for every tool via `--auto-input-until-mergeable` (issue #2007). Claude and Agent stream events into the live process through `--input-format stream-json`; codex, opencode, gemini, qwen, and unknown tools use a universal restart/resume fallback that waits for the current turn to finish in the JSON output, stops the process, and resumes the AI session with the new events. Adds issue title/description edit detection as a restart trigger, reworks the capability matrix to report each tool's delivery mode, and records the `@link-assistant/agent` 0.24.1 live stream-json contract.
