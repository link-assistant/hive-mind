---
"@link-assistant/hive-mind": minor
---

Add full support for Claude Opus 5 (`claude-opus-5`) and make it the default model for `--tool claude` (and therefore for the `/claude` and `/solve` commands). The bare `opus` alias now resolves to `claude-opus-5` (previously `claude-opus-4-8`). Opus 5 supports 1M context (`[1m]`), the full effort ladder including `xhigh` and `max`, 128K max output tokens, and adaptive-thinking-only environment handling. Explicit `opus-5`/`claude-opus-5` aliases now correctly receive `xhigh` effort. The `opus-4-8`/`claude-opus-4-8` (and earlier) aliases are retained for backward compatibility. (Issue #2096)
