---
'@link-assistant/hive-mind': patch
---

fix: add surrogate pair sanitization to prevent JSON API errors

Fixes #1204 where Claude Code CLI would crash with "The request body is not valid JSON: no low surrogate in string" error when tool outputs contained lone Unicode surrogates. The fix sanitizes all string values in prompts and interactive mode comments by replacing lone surrogates (U+D800-U+DFFF) with U+FFFD (Unicode replacement character).
