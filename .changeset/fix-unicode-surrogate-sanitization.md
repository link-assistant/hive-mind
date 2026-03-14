---
'@link-assistant/hive-mind': patch
---

fix: sanitize orphaned UTF-16 surrogates across all CLI output parsing paths (Issue #1324)

Extract `sanitizeUnicode()` and `sanitizeObjectStrings()` into a shared `unicode-sanitization.lib.mjs` module and apply sanitization in all CLI output parsing paths — `claude.lib.mjs`, `agent.lib.mjs`, `codex.lib.mjs`, `opencode.lib.mjs`, and `interactive-mode.lib.mjs`. This ensures orphaned UTF-16 surrogates (from Claude CLI's `<persisted-output>` truncation) are replaced with U+FFFD before any JSON re-serialization, logging, or API calls. Add 62 unit tests covering surrogate edge cases, real-world Claude NDJSON events, and JSON round-trip safety.
