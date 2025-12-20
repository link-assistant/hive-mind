---
"@link-assistant/hive-mind": patch
---

Add automatic README.md initialization for repositories without README

This release adds automatic README.md creation for repositories that don't have one after cloning. This feature ensures all repositories have proper documentation from the start and complements the existing empty repository handling.

**New Features:**
- Automatic detection of missing README.md after cloning
- Creates README with repository title and description (if available)
- Commits and pushes the README to the default branch
- Graceful handling of permission errors (commits locally if push fails)
- Works with both direct repository access and fork workflows

**Implementation:**
- Added `ensureReadmeExists()` function in `src/solve.repository.lib.mjs`
- Integrated into repository setup flow in `src/solve.repo-setup.lib.mjs`
- Called automatically after cloning in `setupRepositoryAndClone()`

**Example README Content:**
For a repository named `hive-mind` with description "The AI that controls AIs.", the generated README.md will be:
```markdown
# hive-mind

The AI that controls AIs.
```

**Workflow Support:**
- Direct access (with write permissions): README is created, committed, and pushed
- Fork workflow: README is created in the fork and included in PRs
- Read-only scenario: README is created locally and included in work

Fixes #706
