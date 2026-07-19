---
'@link-assistant/hive-mind': patch
---

Verify required Codex Agent Skills against the catalog the model actually receives instead of trusting plugin enablement, so a plugin reported as installed but whose skills are invisible is reported with an actionable diagnostic rather than passing the preflight.
