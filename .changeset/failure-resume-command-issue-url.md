---
'@link-assistant/hive-mind': patch
---

Fix the resume command on failed runs (issue #2843). The failure path read `argv.url`, which solve never sets (its positional is `issue-url`), so a failed `--tool codex` (or any non-claude) run printed an empty "To continue this session" hint and passed no resume command to the failure report. The failure hint now always shows `Solve resume mode: solve <url> --resume <session> --tool <tool> …`, and the codex, gemini, claude, agent, opencode and qwen adapters build their resume commands from the same resolved URL. The agent, opencode and qwen usage-limit messages no longer print `undefined` for the URL and now keep `--tool`, model and working directory.
