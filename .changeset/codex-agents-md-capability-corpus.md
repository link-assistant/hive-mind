---
'@link-assistant/hive-mind': patch
---

Read the target repository's own agent instructions when deciding which Codex plugins and skills to provision. The capability preflight previously built its requirement corpus from the GitHub issue alone, so a repository that mandates a plugin in `AGENTS.md` — where the convention says to put it — provisioned nothing, and the model's own `request_plugin_install` attempt was rejected by Codex as an unrecognized `plugin_id`. Root and nested `AGENTS.md`, `CLAUDE.md` and `.codex/*.md` files under the checkout now feed the detector through a bounded walk that reports what it skipped, the zero-requirement path logs the sources it scanned instead of staying silent, a runtime plugin-install rejection is recognized and fails the run with a named diagnostic when the session produced no file changes, and `--require-codex-plugin` / `HIVE_MIND_CODEX_REQUIRED_PLUGINS` can state a requirement that no document spells out.
