---
'@link-assistant/hive-mind': patch
---

Fix Sentry CLI 3.x compatibility to restore Docker image publishing

- Update `scripts/upload-sourcemaps.mjs` to use `sourcemaps upload` command instead of deprecated `releases files` command
- Add case study documentation for issue #962 investigation
