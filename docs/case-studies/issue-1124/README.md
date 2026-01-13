# Case Study: Playwright MCP Auto-Cleanup Issue (Issue #1124)

## Summary

When Playwright MCP is enabled for browser automation tasks, it creates a `.playwright-mcp/` folder in the working directory to store screenshots and other browser artifacts. This folder is not part of the repository and should not be committed, but it triggers the "uncommitted changes detected" auto-restart mechanism, causing unnecessary session restarts.

**Root Cause**: The `.playwright-mcp/` folder is created by Playwright MCP during browser automation but is not automatically cleaned up after the session. The auto-restart mechanism detects it as uncommitted changes and triggers a restart loop.

**Impact**:
- Unnecessary auto-restart iterations consuming additional API costs
- User confusion about the auto-restart behavior
- Potential for infinite restart loops if not handled properly

## Timeline of Events

### Original Issue: js-playground PR #2

**Date**: 2026-01-13

1. **19:15:11** - Session started for issue #1 (JavaScript playground feature)
2. **19:15:12** - No uncommitted changes found initially
3. **19:19:XX - 19:25:XX** - Claude used Playwright MCP tools to test the playground:
   - `mcp__playwright__browser_navigate` - Navigated to localhost
   - `mcp__playwright__browser_click` - Clicked elements
   - `mcp__playwright__browser_evaluate` - Evaluated JavaScript
   - Screenshots saved to `.playwright-mcp/` folder
4. **19:25:46** - Session completed successfully
5. **19:25:47** - Post-session check found uncommitted changes:
   ```
   ?? .playwright-mcp/
   ```
6. **19:25:47** - Auto-restart triggered due to uncommitted changes
7. **19:26:02** - Auto-restart comment posted to PR #2:
   > "Detected uncommitted changes from previous run. Starting new session to review and commit them."

### Evidence

The solution draft log (solution-draft-log-1.txt) shows:

```
[2026-01-13T19:25:47.286Z] [INFO] 📝 Found uncommitted changes
[2026-01-13T19:25:47.286Z] [INFO] Changes:
[2026-01-13T19:25:47.286Z] [INFO]    ?? .playwright-mcp/
[2026-01-13T19:25:47.287Z] [INFO]
⚠️  IMPORTANT: Uncommitted changes detected!
[2026-01-13T19:25:47.287Z] [INFO]    Claude made changes that were not committed.

[2026-01-13T19:25:47.287Z] [INFO] 🔄 AUTO-RESTART: Restarting Claude to handle uncommitted changes...
```

## Root Causes

### 1. Playwright MCP Creates Artifacts in Working Directory

The Playwright MCP server stores screenshots and other browser artifacts in a `.playwright-mcp/` folder:

```
/tmp/gh-issue-solver-1768331693975/.playwright-mcp/playground-desktop.png
```

This is by design - it allows the AI to reference these files in subsequent tool calls.

### 2. No Automatic Cleanup Mechanism

The hive-mind solve command doesn't clean up the `.playwright-mcp/` folder after:
- Session completion
- Before checking for uncommitted changes
- During the CLAUDE.md revert process

### 3. Auto-Restart Treats All Uncommitted Files Equally

The current `checkForUncommittedChanges` function treats all uncommitted files as requiring action:

```javascript
const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
if (statusOutput) {
  // Triggers auto-restart for ANY uncommitted changes
}
```

It doesn't distinguish between:
- Files that should be committed (actual code changes)
- Files that should be ignored (like `.playwright-mcp/`)

## Proposed Solutions

### Solution 1: Auto-Cleanup `.playwright-mcp/` Before Uncommitted Check (Recommended)

Clean up the `.playwright-mcp/` folder automatically before checking for uncommitted changes:

```javascript
// Before calling checkForUncommittedChanges
if (argv.playwrightMcpAutoCleanup !== false) {
  const playwrightMcpDir = path.join(tempDir, '.playwright-mcp');
  if (await fs.exists(playwrightMcpDir)) {
    await fs.rm(playwrightMcpDir, { recursive: true, force: true });
    await log('🧹 Cleaned up .playwright-mcp/ folder', { verbose: true });
  }
}
```

**Pros**:
- Clean working directory after session
- No confusion about uncommitted changes
- Doesn't affect actual code changes

**Cons**:
- Screenshots and artifacts are lost (but they're in the log anyway)

### Solution 2: Add `--no-playwright-mcp-auto-cleanup` Option

Provide a CLI flag to disable auto-cleanup for debugging purposes:

```
--no-playwright-mcp-auto-cleanup  Keep .playwright-mcp/ folder after session
```

### Solution 3: Exclude `.playwright-mcp/` from Uncommitted Changes Check

Filter out `.playwright-mcp/` when checking for uncommitted changes:

```javascript
const lines = statusOutput.split('\n').filter(line =>
  !line.includes('.playwright-mcp/')
);
if (lines.length > 0) {
  // Only restart if there are OTHER uncommitted changes
}
```

## Implementation Plan

1. Add `cleanupPlaywrightMcpFolder` function to `solve.mjs` or a new utility module
2. Call cleanup before `checkForUncommittedChanges` in the main solve flow
3. Add `--no-playwright-mcp-auto-cleanup` CLI option
4. Update documentation

## References

- [Issue #1124](https://github.com/link-assistant/hive-mind/issues/1124)
- [PR #2 Comment (auto-restart)](https://github.com/open-online-tools/js-playground/pull/2#issuecomment-3746069322)
- [Case Study: Issue #837 - Playwright MCP Chrome Leak](../issue-837-playwright-mcp-chrome-leak/README.md)
- [Playwright MCP Documentation](https://github.com/microsoft/playwright-mcp)

## Evidence Files

- [solution-draft-log-1.txt](./evidence/solution-draft-log-1.txt) - First session log showing Playwright MCP usage and auto-restart trigger
- [solution-draft-log-2.txt](./evidence/solution-draft-log-2.txt) - Second session log (auto-restart session)

## Authors

- Investigation: AI Assistant (Claude Opus 4.5)
- Issue Reporter: @konard
- Date: 2026-01-13
