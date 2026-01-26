---
'@link-assistant/hive-mind': patch
---

fix: support opencode/gpt-5-nano and gpt-5-nano for --tool agent (Issue #1185)

Fixed AGENT_MODELS mapping to correctly support free OpenCode Zen models:

- `gpt-5-nano` short alias now correctly maps to `opencode/gpt-5-nano` (previously incorrectly mapped to `openai/gpt-5-nano`)
- `opencode/gpt-5-nano` full model ID is now recognized as valid
- Updated `mapModelToId` function in agent.lib.mjs to use correct provider prefix
- Fixed regex filter in `getAvailableModelNames` to include `gpt-5-nano` in available models display
- Added comprehensive test suite with 18 tests for agent model validation
- Added case study documentation with root cause analysis
