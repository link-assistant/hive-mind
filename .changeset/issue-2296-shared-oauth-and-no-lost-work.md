---
'@link-assistant/hive-mind': minor
---

Keep shared Claude Code / Codex OAuth working in Docker isolation by sharing the config directory (with per-task private overlays) instead of a single-file credential mount, resume the session after a transient 401 / OAuth refresh failure (`--auth-retry-attempts`, default 2), exit non-zero and WIP-commit uncommitted work when the AI tool fails or the workspace still holds unsaved work (so start-command keeps the container), link every part of a split failure log and name the part with the failure, and treat a Claude result with `is_error: true` as an error even when its subtype is `success`.
