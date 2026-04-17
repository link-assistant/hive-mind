---
'@link-assistant/hive-mind': patch
---

Fix `--auto-attach-solution-summary` falsely detecting solve.mjs's own session bookkeeping comments ("AI Work Session Started", "Solution Draft Log", "Auto-restart", "Ready to merge", etc.) as AI-authored comments, which caused the solution summary to always be suppressed even when the AI session produced no comments of its own.

The fix introduces a new `src/tool-comments.lib.mjs` module as the single source of truth for every marker string embedded in tool-posted comments, along with in-memory tracking of the GitHub comment IDs that solve.mjs itself creates during a session. `checkForAiCreatedComments` now uses the tracked ID set as the primary filter — any comment the tool posted in this session is excluded regardless of body text — and falls back to marker-based substring matching only when an ID was not captured.

Every tool-posting site (`solve.session.lib.mjs`, `solve.auto-merge.lib.mjs`, `solve.watch.lib.mjs`, `github.lib.mjs`'s `attachLogToGitHub`/`attachTruncatedLog`/`attachRegularComment`, `claude.lib.mjs`'s force-kill notice, `interactive-mode.lib.mjs`, `solve.progress-monitoring.lib.mjs`, `solve.repo-setup.lib.mjs`, `solve.repository.lib.mjs`, and `solve.mjs`'s usage-limit notifications) now routes through `postTrackedComment` / `postTrackedCommentFromFile`, so every solve-posted comment is registered and filtered correctly across all supported AI tools (claude, codex, agent, opencode). See issue #1625.
