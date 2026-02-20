---
'@link-assistant/hive-mind': patch
---

fix: sanitize orphaned UTF-16 surrogates to prevent Anthropic API 400 errors (Issue #1324)

Add `sanitizeUnicode()` to `interactive-mode.lib.mjs` that replaces orphaned UTF-16 surrogate characters (those not part of a valid surrogate pair) with the Unicode replacement character U+FFFD. Apply it in `truncateMiddle()` and `safeJsonStringify()` so that truncated content containing emoji surrogate pairs never produces invalid JSON that the Anthropic API rejects. Add 13 unit tests covering all surrogate edge cases, including a direct reproduction of the root cause from issue #1324.
