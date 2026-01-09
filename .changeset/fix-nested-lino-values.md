---
'@link-assistant/hive-mind': patch
---

Add validation for LINO configuration to detect invalid input

- Add validation in `lenv-reader.lib.mjs` to reject multiple values on the same line (e.g., `--option1  --option2`)
- Add validation to reject unrecognized characters in command-line options (e.g., `?`, `@`, `!`)
- Errors include clear messages showing the problematic value and instructions for correction
- Valid option characters: letters, numbers, hyphens, underscores, equals signs
- Add comprehensive unit tests for LINO parsing logic (`test-lino.mjs`)
- Add validation tests to lenv-reader test suite (`test-lenv-reader.mjs`)
- Add lino tests to CI/CD workflow

This approach helps users identify and correct configuration errors early, rather than silently dropping invalid options.

Fixes #1086
