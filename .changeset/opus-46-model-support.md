---
'@link-assistant/hive-mind': minor
---

Add Claude Opus 4.6 model support with [1m] suffix

- `opus` alias now defaults to `claude-opus-4-6` (latest and most capable Opus model)
- Added shorter version aliases: `opus-4-6`, `opus-4-5`, `sonnet-4-5`, `haiku-4-5`
- Added `claude-haiku-4-5` alias for consistency
- `[1m]` suffix enables 1 million token context window for supported models
- Opus 4.6 gets 128K max output tokens and 64K thinking budget
- Backward compatibility: `claude-opus-4-5` maps to `claude-opus-4-5-20251101`
