# Claude Code CLI Issues

This directory contains documentation and reproducible test cases for issues encountered with the Claude Code CLI (`@anthropic-ai/claude-code`).

## Reporting Claude Code Issues

If you encounter issues with the Claude Code CLI, please report them to the official repository:
- **GitHub Issues**: https://github.com/anthropics/claude-code/issues
- **Repository**: https://github.com/anthropics/claude-code

This includes:
- Installation errors (e.g., module not found)
- Command execution failures
- Authentication problems
- Performance issues
- Any other CLI-related bugs

## Issues Documented

1. **issue-01-kill-eperm-timeout.md** - EPERM error when killing timed-out processes, resulting in false success reporting

## Critical Issues

⚠️ **Issue #1 - Kill EPERM on Timeout**: When a command times out (default 2 minutes), the Claude CLI attempts to kill the running process. On some systems, this results in an `EPERM` (permission error) when calling `process.kill()`. This error is logged to stderr but doesn't properly fail the command, leading to:
- "✅ Claude command completed" shown despite the error
- messageCount: 0, toolUseCount: 0 (no actual work done)
- Pull requests marked as ready for review when they should fail
- False success reports in logs and PR comments

## Impact

This issue affects automated issue solving workflows where:
- Commands may timeout during long-running operations (apt-get, compilation, etc.)
- The system incorrectly reports success when the command actually failed
- Users receive misleading PR comments indicating success
- No clear indication of what went wrong

## Root Cause Analysis

### Timeline of Events
1. Command is executed with 120000ms (2 minute) timeout
2. Command runs longer than timeout period
3. Claude CLI attempts to kill the process using `process.kill()`
4. System returns EPERM error (insufficient permissions)
5. Error is logged to stderr: `Error: kill EPERM`
6. Exit event is never sent or exit code is 0
7. `commandFailed` flag remains `false`
8. System shows "✅ Claude command completed"
9. PR is marked as ready for review

### Technical Details

**Error Stack Trace:**
```
[2025-10-01T22:25:49.285Z] [INFO] Error: kill EPERM
    at process.kill (node:internal/process/per_thread:225:13)
    at o3A (file:///home/hive/.nvm/versions/node/v20.19.5/lib/node_modules/@anthropic-ai/claude-code/cli.js:115:3109)
    ...
    errno: -1,
    code: 'EPERM',
    syscall: 'kill'
```

**Evidence of False Success:**
```
✅ Claude command completed
📊 Total messages: 0, Tool uses: 0
✅ No uncommitted changes found
📦 Committed: CLAUDE.md deletion
📤 Pushed: CLAUDE.md removal to GitHub
🔄 Converting PR from draft to ready for review...
✅ PR converted to ready for review
```

### Why EPERM Occurs

The EPERM error when killing processes can occur due to:

1. **Process Ownership Issues**: The child process may have changed its user/group and the parent no longer has permission to kill it
2. **Security Policies**: Some systems (containers, VMs, CI runners) have security policies that prevent cross-process signals
3. **Race Conditions**: The process may have already exited or changed state when kill is attempted
4. **Sudo/Privilege Escalation**: If the child process used sudo or elevated privileges, the parent may not be able to kill it

### System Context

From the logs, the command that timed out was:
```bash
sudo apt-get update -qq && sudo apt-get install -y fp-utils-3.2.2
```

This explains the EPERM issue:
- The command uses `sudo` which elevates privileges
- The child process runs as root
- The parent Node.js process runs as a regular user
- When timeout occurs, the regular user cannot kill the root process
- Result: EPERM error

## Workarounds

Until this is fixed in Claude Code CLI:

### 1. Increase Timeout
For commands that may run long, increase the timeout:
```javascript
// Instead of default 120000ms (2 minutes)
timeout: 240000  // 4 minutes
```

### 2. Run Sudo Commands in Background (RECOMMENDED)
**This is the primary workaround for the EPERM timeout issue.**

When executing sudo commands (especially package installations), run them in the background to avoid timeout-related kill EPERM errors:

```bash
# Instead of:
sudo apt-get update && sudo apt-get install -y package

# Use background execution:
sudo apt-get update && sudo apt-get install -y package &

# Or with Claude Code Bash tool:
# Set run_in_background: true parameter
```

**Why this works:**
- Background processes don't trigger the timeout kill mechanism
- Avoids the EPERM error when trying to kill privileged processes
- Process can complete naturally without interference
- Can monitor output using BashOutput tool

**System Prompt Integration:**
Our system prompt now instructs Claude to:
> "When running sudo commands (especially package installations like apt-get, yum, npm install, etc.), always run them in the background to avoid timeout issues and permission errors when the process needs to be killed."

### 3. Avoid Sudo in Commands
When possible, avoid using sudo in commands executed by Claude:
```bash
# Instead of:
sudo apt-get install package

# Use:
apt-get install package  # If container already has privileges
# OR pre-install dependencies in Docker image
```

### 4. Better Failure Detection (Our Fix)
Track stderr errors and detect silent failures:
```javascript
// Track stderr errors
const stderrErrors = [];
if (chunk.type === 'stderr') {
  const errorOutput = chunk.data.toString();
  if (errorOutput) {
    stderrErrors.push(errorOutput);
  }
}

// After loop, check for silent failures
if (!commandFailed && messageCount === 0 && toolUseCount === 0 && stderrErrors.length > 0) {
  commandFailed = true;
  await log(`\n❌ Command failed: No output produced but errors were logged:\n${stderrErrors.join('\n')}`);
}
```

## Recommendations for Claude Code CLI

1. **Proper Error Handling for Kill Operations**
   - Catch EPERM and other errors when killing processes
   - Mark command as failed when kill fails
   - Log clear error message about permission issues

2. **Better Timeout Handling**
   - Use process groups to kill entire process tree
   - Handle sudo/privilege escalation scenarios
   - Provide clear feedback when timeout occurs

3. **Improved Exit Detection**
   - Ensure exit event is always sent, even on errors
   - Include error information in exit event
   - Don't rely solely on exit code for success determination

4. **Enhanced Logging**
   - Clearly distinguish between success and failure states
   - Log timeout events with context
   - Include stderr errors in failure reports

5. **Graceful Degradation**
   - When kill fails, try SIGTERM first, then SIGKILL
   - Wait for process to exit naturally if possible
   - Provide options to customize timeout behavior

## Testing

To reproduce this issue:
1. Run a command that requires sudo and takes > 2 minutes
2. Observe the EPERM error when Claude CLI tries to kill it
3. Note that command is marked as successful despite the error

Example command that reproduces the issue:
```bash
claude-code --timeout 120000 "sudo apt-get update && sudo apt-get install -y some-large-package"
```

## Related Issues

- Original issue: https://github.com/link-assistant/hive-mind/issues/371
- Related PR: https://github.com/zamtmn/fpdwg/pull/11

## Status

**Workaround Implemented**: We've added detection for silent failures in our codebase (see src/claude.lib.mjs)

**Upstream Fix Needed**: This issue should be reported to the Claude Code CLI team for proper handling of kill errors and timeout scenarios.
