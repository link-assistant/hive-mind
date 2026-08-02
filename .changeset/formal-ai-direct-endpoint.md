---
'@link-assistant/hive-mind': patch
---

Make `--model formal-ai` work for every tool by talking to Formal AI directly instead of through the `formal-ai with` wrapper. Hive Mind now starts `formal-ai serve --agent-mode` and points each CLI at that endpoint through its own native configuration channel — `CODEX_HOME` for codex, a settings file for gemini, `OPENAI_MODEL` for qwen — so the wrapper can no longer rewrite the argv, drop the caller's prompt, or send codex traffic to `api.openai.com`. The operator's `HOME`, git, gh and ssh configuration is never shadowed.

Also removes the log noise and false verdicts the same runs exposed: read-only `gh`/`git` probes no longer mirror their raw payloads into the log that `--attach-logs` uploads (`gh auth status --show-token` was printing a live credential in clear text), codex no longer warns on every run, an expected 404 is no longer printed as an error, `gh auth setup-git` no longer fails on a bind-mounted `~/.gitconfig`, and "No working session summary available" is no longer reported for a session that produced one. The Formal AI wrapper version is recorded in the solve log, and the runtime logs its endpoint, protocol, config root and environment for the next iteration.
