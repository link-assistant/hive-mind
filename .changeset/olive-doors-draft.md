---
'@link-assistant/hive-mind': patch
---

Put the pull request back into draft whenever a working session starts, restarts or resumes (issue #2123). Draft/ready transitions now live in one shared module (`src/pr-draft-state.lib.mjs`) that is called from `startWorkSession()` for every continue-mode session — the previous `--watch`/`--auto-continue` gate is gone — and from `executeToolIteration()`, which covers watch mode, temporary auto-restart on uncommitted changes, auto-restart-until-mergeable, escalate, keep-working and auto-ensure-requirements. Limit-reset auto-resume/auto-restart now also forwards `--auto-continue` so the resumed process re-attaches to the existing PR instead of running detached from it. The helper is a no-op for PRs that are already in the target state, merged or closed, and logs the observed `isDraft`/`state` under `--verbose`.
