---
'@link-assistant/hive-mind': minor
---

Add experimental live progress monitoring for work sessions

- Implement `--working-session-live-progress` CLI flag for both solve and hive commands
- Create new progress monitoring module (`solve.progress-monitoring.lib.mjs`) with:
  - Live TODO list tracking from TodoWrite tool calls
  - Progress bar visualization (percentage complete)
  - Automatic PR description updates with progress section
  - Rate limiting to avoid GitHub API throttling
- Integrate progress monitoring into claude.lib.mjs event stream processing
  - Detects TodoWrite tool_use events (assistant) and tool_use_result events (user)
  - Updates PR description when TodoWrite tool is invoked
  - Displays task completion stats and progress bar
  - Supports work session identification
- Works with or without `--interactive-mode` (independent feature)
- Auto-registered in hive via SOLVE_OPTION_DEFINITIONS (no manual forwarding needed)
- Add comprehensive test suite (29 tests) covering:
  - Progress calculation and formatting
  - CLI configuration in solve and hive
  - Auto-registration and forwarding via getSolvePassthroughOptionNames
  - Claude integration for TodoWrite detection
- Feature is experimental, opt-in via `--working-session-live-progress`
- Implements issue #936
