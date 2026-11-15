---
'@link-assistant/hive-mind': patch
---

Update dependencies that the CI dependency freshness gate reported as stale on 2026-11-15: `secretlint`, `@secretlint/core` and `@secretlint/profiler` to v14, `@link-foundation/sensitive-data-sanitizer` to 0.23.0 and `links-notation` to 0.31.6. Secretlint v14 ships the recommended preset inside `@secretlint/core/builtin` (the `@secretlint/secretlint-rule-preset-recommend` package is no longer published), so secret scanning now loads it from there with the same rule ids. The v14 profiler is opt-in and exposes `getStats()` instead of `getEntries()`; the issue #2400 regression test accepts both.
