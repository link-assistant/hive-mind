---
"@link-assistant/hive-mind": minor
---

Add experimental live progress monitoring for work sessions

- Implement `--working-session-live-progress` CLI flag for both solve and hive commands
- Create new progress monitoring module (`solve.progress-monitoring.lib.mjs`) with:
  - Live TODO list tracking from TodoWrite tool calls
  - Progress bar visualization (percentage complete)
  - Automatic PR description updates with progress section
  - Rate limiting to avoid GitHub API throttling
- Integrate progress monitoring into interactive mode
  - Updates PR description when TodoWrite tool is invoked
  - Displays task completion stats and progress bar
  - Supports work session identification
- Add comprehensive test suite (29 tests) covering:
  - Progress calculation and formatting
  - CLI configuration in solve and hive
  - Option forwarding from hive to solve
  - Interactive mode integration
- Feature is experimental and requires `--interactive-mode` to be enabled
- Implements issue #936
