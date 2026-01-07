---
'@link-assistant/hive-mind': patch
---

Fix Claude Code output token limit by setting CLAUDE_CODE_MAX_OUTPUT_TOKENS to 64000

- Claude Code CLI defaults to 32K output token limit, but Claude Sonnet/Opus/Haiku 4.5 models support 64K
- Added `claudeCode.maxOutputTokens` configuration in `config.lib.mjs` (default: 64000)
- Pass `CLAUDE_CODE_MAX_OUTPUT_TOKENS` environment variable when executing Claude CLI
- Configuration can be overridden via `CLAUDE_CODE_MAX_OUTPUT_TOKENS` or `HIVE_MIND_CLAUDE_CODE_MAX_OUTPUT_TOKENS` environment variables
- Added comprehensive case study analysis in `docs/case-studies/issue-1076/`

See: https://github.com/link-assistant/hive-mind/issues/1076
