# Installed vs published agentic CLI versions, 2026-09-04

| CLI        | npm package                 | installed | latest published |
| ---------- | --------------------------- | --------- | ---------------- |
| `claude`   | `@anthropic-ai/claude-code` | 2.1.251   | 2.1.260          |
| `codex`    | `@openai/codex`             | 0.150.1   | 0.153.2          |
| `agent`    | `@link-assistant/agent`     | 0.26.0    | 0.26.1           |
| `gemini`   | `@google/gemini-cli`        | 0.57.0    | 0.58.0           |
| `qwen`     | `@qwen-code/qwen-code`      | 0.22.3    | 0.23.0           |
| `opencode` | `opencode-ai`               | 1.18.25   | 1.18.28          |

Every installed CLI on this host is behind its published version. Two of the
gaps are load-bearing for issue #2202:

- **`codex` 0.150.1 → 0.153.2.** The installed catalogue
  (`codex-debug-models.json`) has 10 models and no `gpt-6-astra`.
- **`claude` 2.1.251 → 2.1.260.** The router's own client guide states
  "Claude Code 2.1.255 or newer is required for current aliases"
  (`../upstream/router-with-command.md`). The installed Claude Code is
  **below** that floor, so `--use-router` on this host would hit the alias
  problem the router documents, and no amount of catalogue work in Hive Mind
  would fix it. Updating the CLI is the fix — which is precisely R6.
