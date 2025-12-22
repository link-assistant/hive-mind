---
'@link-assistant/hive-mind': patch
---

Fix sentry-cli source maps upload command for v3.0.0+ API

Updated `scripts/upload-sourcemaps.mjs` to use the new `sentry-cli sourcemaps upload` command syntax instead of the deprecated `sentry-cli releases files upload-sourcemaps` which was removed in sentry-cli 3.0.0.
