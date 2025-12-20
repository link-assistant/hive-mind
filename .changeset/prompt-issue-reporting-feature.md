---
"@link-assistant/hive-mind": minor
---

Add --prompt-issue-reporting flag for automatic issue creation

This release introduces a new opt-in feature that enables the AI to automatically create GitHub issues when it spots bugs, errors, or minor issues during working sessions that are not related to the main task.

**New Features:**
- Added `--prompt-issue-reporting` CLI flag (disabled by default)
- Issues include reproducible examples, workarounds, and fix suggestions
- Supports creating issues in both current and third-party repositories
- Automatic duplicate checking before creating issues

**Usage:**
```bash
hive solve <issue-url> --prompt-issue-reporting
solve <issue-url> --prompt-issue-reporting
```

**Implementation:**
- New guideline in system prompt (conditional on flag)
- Flag added to both `hive` and `solve` commands
- Uses `gh` CLI for authenticated issue creation (works with private repos)

This feature helps ensure that no bugs slip through the cracks during development while giving users full control over when it's active.
