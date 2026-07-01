---
"@link-assistant/hive-mind": minor
---

Add full support for Claude Sonnet 5 (`claude-sonnet-5`) and make it the default model for `--tool claude`. The bare `sonnet` alias now resolves to `claude-sonnet-5` (previously `claude-sonnet-4-6`). Sonnet 5 supports 1M context (`[1m]`), the full effort ladder including `xhigh` and `max`, 128K max output tokens, and adaptive-thinking-only environment handling. The `sonnet-4-6`/`claude-sonnet-4-6` aliases are retained for backward compatibility. (Issue #2003)
