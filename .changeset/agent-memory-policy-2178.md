---
'@link-assistant/hive-mind': minor
---

Turn off every AI tool's own cross-task memory and Claude Code's auto-mode classifier by default (issue #2178).

A hive-mind task is a disposable container that opens one pull request. The repository — commits, issues, pull requests, case studies — is meant to be the only memory it keeps, because it is the only memory a reviewer can see, correct or revert. Every agentic CLI has since grown a private cross-session store that works against that, and the largest of them (Gemini CLI's auto-memory) is a whole second agent re-reading past sessions on a second model.

`--agent-memory-disabled` is new and defaults to `true`. It applies, per tool:

- **claude** — `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, `CLAUDE_CODE_DISABLE_ORG_MEMORY=1`, `autoMemoryEnabled: false`, and `permissions.disableAutoMode: "disable"`. The last one is what removes the classifier: auto mode is what pays for it, and the settings gate is checked before the provider and model gates, so it holds everywhere the environment-variable opt-in would not. Tasks already run `--dangerously-skip-permissions` inside a disposable container, so a classifier deciding whether an action is safe is answering a question that has already been answered.
- **codex** — `-c features.memories=false -c features.external_agent_memory_import=false`, on both the `codex exec` path and the `--use-agent-commander` path. Both default to off upstream today, but `memories` is a stable-stage flag, so pinning it per run is what makes the default actually hold.
- **gemini, qwen** — `tools.exclude: ["save_memory"]` and `experimental.autoMemory: false`, merged into the tool's settings file without disturbing anything else already there.
- **opencode, agent** — no cross-session memory feature was found in either; recorded explicitly so the claim can be re-checked rather than assumed.

`--no-agent-memory-disabled` opts out for codex, gemini and qwen, and when it does the policy adds no arguments at all rather than arguments set to `true`. It does not reach claude: those switches are `ENV` lines in the Docker image and settings written by `configure-claude`, neither of which sees a `solve` argv, so they stay off either way and the flag's description says so.
