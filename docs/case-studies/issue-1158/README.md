# Case Study: CLAUDE.md File Should Not Be Used for `--tool agent` (Issue #1158)

## Overview

This case study documents the issue where `--tool agent` was using `CLAUDE.md` file by default for task details, which pollutes the Claude Code project-level instruction file. The correct behavior should use `.gitkeep` file by default for `--tool agent`, with `--claude-file` disabled by default for this tool.

## Timeline of Events

### Background: How hive-mind Passes Task Details to AI Tools

When `solve` runs, it needs to pass task information (issue URL, branch name, working directory) to the AI tool. The system supports two methods:

1. **CLAUDE.md file** (`--claude-file`, default=true): Creates a `CLAUDE.md` file with task details
2. **.gitkeep file** (`--gitkeep-file`, default=false): Creates a `.gitkeep` file with task details

### The Problem (January 23, 2026)

1. **User ran `solve` with `--tool agent`** on a test repository
   - Repository: `konard/test-hello-world-019bea4f-95dc-702e-8887-c1f4975529b6`
   - Issue: https://github.com/konard/test-hello-world-019bea4f-95dc-702e-8887-c1f4975529b6/issues/1

2. **Initial commit created CLAUDE.md** (commit `400ab4c6`, 2026-01-23T10:05:07Z):

   ```
   Initial commit with task details

   Adding CLAUDE.md with task information for AI processing.
   This file will be removed when the task is complete.
   ```

3. **CLAUDE.md content was:**

   ```
   Issue to solve: https://github.com/konard/test-hello-world-019bea4f-95dc-702e-8887-c1f4975529b6/issues/1
   Your prepared branch: issue-1-38db1a45e767
   Your prepared working directory: /tmp/gh-issue-solver-1769196709914

   Proceed.
   ```

4. **Task completed successfully** (commits `4ecd9f44`, `ed92a35` at ~10:07:04-10:07:08Z)

5. **CLAUDE.md was reverted** (commit `8bffa67d`, 2026-01-23T10:08:00Z)

### Why This Is a Problem

The `CLAUDE.md` file has special meaning in Claude Code - it serves as a project-level instruction file similar to a `.cursorrules` or `.github/copilot-instructions.md`. Writing temporary task details to this file:

1. **Pollutes the project's Claude Code configuration** if the repository already has a CLAUDE.md
2. **Creates unnecessary git history noise** with commits to add and revert CLAUDE.md
3. **May confuse other tools** that read CLAUDE.md for project context
4. **Is semantically incorrect** - task details are not project instructions

## Root Cause Analysis

### Primary Root Cause: Uniform Defaults Across All Tools

The `--claude-file` option defaults to `true` for all tools, regardless of whether the tool is Claude Code (`--tool claude`) or another tool (`--tool agent`, `--tool opencode`, `--tool codex`).

**Code location:** `src/solve.config.lib.mjs:131-145`

```javascript
.option('claude-file', {
  type: 'boolean',
  description: 'Create CLAUDE.md file for task details (default, mutually exclusive with --gitkeep-file)',
  default: true,  // <-- Same default for ALL tools
})
.option('gitkeep-file', {
  type: 'boolean',
  description: 'Create .gitkeep file instead of CLAUDE.md (mutually exclusive with --claude-file)',
  default: false,  // <-- Same default for ALL tools
})
```

### Why CLAUDE.md Makes Sense for `--tool claude`

For Claude Code (`--tool claude`), using CLAUDE.md is appropriate because:

- Claude Code reads CLAUDE.md as part of its project context
- The task details become part of Claude's context window
- It's a direct communication channel to the AI tool

### Why .gitkeep Is Better for Other Tools

For non-Claude tools (`--tool agent`, `--tool opencode`, `--tool codex`):

- These tools don't have special handling for CLAUDE.md
- The task details are passed via command-line arguments or prompts
- CLAUDE.md has no special meaning to these tools
- Using .gitkeep avoids polluting a file with special meaning

## Evidence

### Commit History from External Repository

| SHA        | Time     | Message                                                       |
| ---------- | -------- | ------------------------------------------------------------- |
| `400ab4c6` | 10:05:07 | Initial commit with task details (added CLAUDE.md)            |
| `4ecd9f44` | 10:07:04 | Add Hello World program in Ruby                               |
| `ed92a358` | 10:07:08 | Add GitHub Actions workflow for testing Hello World           |
| `8bffa67d` | 10:08:00 | Revert "Initial commit with task details" (removed CLAUDE.md) |

### Raw Data

- [PR #2 Details](./raw-data/pr-2.json)
- [PR #2 Commits](./raw-data/pr-2-commits.json)
- [Commit 400ab4c6](./raw-data/commit-400ab4c6.json)

## Solution

### Change Default Values Based on Tool Type

Modify the argument parsing to set different defaults for `--claude-file` and `--gitkeep-file` based on the selected tool:

| Tool       | `--claude-file` default | `--gitkeep-file` default |
| ---------- | ----------------------- | ------------------------ |
| `claude`   | `true`                  | `false`                  |
| `agent`    | `false`                 | `true`                   |
| `opencode` | `false`                 | `true`                   |
| `codex`    | `false`                 | `true`                   |

### Implementation Approach

Similar to how `--model` has dynamic defaults based on `--tool` (lines 93-107 in solve.config.lib.mjs), add post-parsing logic to set `--claude-file` and `--gitkeep-file` defaults based on tool selection.

### Documentation Updates

1. Update option descriptions to clarify tool-specific defaults
2. Add documentation explaining different default values for different tools
3. Update README if necessary

## Impact

- **User Impact:** Cleaner git history when using non-Claude tools
- **Repository Impact:** No pollution of CLAUDE.md files in repositories
- **Backwards Compatibility:** Users can still explicitly use `--claude-file` with any tool if needed

## Lessons Learned

1. **Tool-specific defaults:** When supporting multiple AI tools, consider which defaults make sense for each tool rather than using uniform defaults.

2. **Semantic file names:** Files with special meaning (like CLAUDE.md) should only be used when that meaning is relevant to the task.

3. **Git history cleanliness:** Temporary files that are immediately reverted add unnecessary noise to git history.

## Files to Change

- `src/solve.config.lib.mjs` - Add tool-specific defaults for `--claude-file` and `--gitkeep-file`
- `README.md` or `docs/CONFIGURATION.md` - Document tool-specific default values

## Test Plan

- [ ] Verify `--tool claude` defaults to `--claude-file`
- [ ] Verify `--tool agent` defaults to `--gitkeep-file`
- [ ] Verify `--tool opencode` defaults to `--gitkeep-file`
- [ ] Verify `--tool codex` defaults to `--gitkeep-file`
- [ ] Verify explicit `--claude-file` works with any tool
- [ ] Verify explicit `--gitkeep-file` works with any tool
- [ ] Verify mutual exclusivity validation still works

## References

- Issue #1158: This incident report
- External PR: https://github.com/konard/test-hello-world-019bea4f-95dc-702e-8887-c1f4975529b6/pull/2
- External Commit: https://github.com/konard/test-hello-world-019bea4f-95dc-702e-8887-c1f4975529b6/commit/400ab4c69f2276d523826cf665196e0f3c204db9
