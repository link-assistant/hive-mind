---
'@link-assistant/hive-mind': patch
---

Report hive runs that process no issues or leave blocked work as warnings with distinct nonzero exit codes. Keep skipped issues separate from completed work, surface discovery failures and existing PR links, and honor deprecated tool-check switches.

Keep sub-issues eligible when a parent's PR also references them, in both batch discovery and worker rechecks, including the REST fallback. Preserve parent-last dependency scheduling when including existing PRs and suggest --no-skip-issues-with-prs --auto-continue when no eligible issues remain, including translated Telegram warnings.
