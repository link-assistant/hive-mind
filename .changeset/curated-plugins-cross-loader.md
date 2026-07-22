---
'@link-assistant/hive-mind': patch
---

Keep locally provisioned `openai-curated` plugins visible when Codex's authenticated remote plugin catalog is enabled. The repository-scoped `remote_plugin` override is written in place for every TOML spelling of the setting, so an operator config that uses a dotted key or an inline table cannot produce a duplicate key that Codex refuses to load.
