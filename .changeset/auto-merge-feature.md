---
'hive-mind': minor
---

Add --auto-merge and --auto-restart-until-mergable options for autonomous PR management

New CLI options:

- `--auto-merge`: Automatically merge the pull request when CI passes and PR is mergeable. Implies --auto-restart-until-mergable.
- `--auto-restart-until-mergable`: Auto-restart the AI agent until PR becomes mergeable (no iteration limit). Restarts on new comments from non-bot users, CI failures, merge conflicts, or uncommitted changes. Does NOT auto-merge.

Features:

- Non-bot comment detection with configurable bot patterns
- Automatic detection of CI/CD status and merge readiness
- Continuous monitoring loop with configurable check intervals
- Progress and status reporting throughout the process
- Graceful handling of API errors with exponential backoff
- Session data tracking for accurate pricing across iterations
