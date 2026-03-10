---
'@link-assistant/hive-mind': patch
---

Disable Sentry error tracking by default for maximum user privacy. Users must now explicitly opt in with `--sentry` flag or `HIVE_MIND_SENTRY=true` env var. This guarantees 100% privacy by default — no usage data is sent to Sentry unless the user chooses to enable it.
