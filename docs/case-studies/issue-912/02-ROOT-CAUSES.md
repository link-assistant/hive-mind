# Root Causes Analysis

## Overview

This document provides deep technical analysis of why resource accumulation occurs on Hive Mind servers and what causes each type of waste.

## Root Cause 1: Incomplete Cleanup of Working Directories

### Description

The `solve` command creates temporary working directories in `/tmp` with the pattern `/tmp/gh-issue-solver-{timestamp}`. These directories contain:

- Cloned Git repositories
- Installed npm dependencies (`node_modules`)
- Build artifacts
- Log files

### Why Cleanup Fails

1. **Exception-based exits**: When solve fails due to an error, the cleanup code in `finally` blocks may not execute properly
2. **Signal handling gaps**: SIGKILL cannot be caught, so cleanup handlers don't run
3. **Subprocess isolation**: Child processes may hold file locks preventing deletion
4. **Race conditions**: Directory may be in use by a subprocess when cleanup attempts

### Evidence

```javascript
// From solve.mjs - cleanup is attempted but not guaranteed
try {
  // solve operations
} finally {
  // cleanup - may not run if process killed
  if (workingDir && fs.existsSync(workingDir)) {
    fs.rmSync(workingDir, { recursive: true, force: true });
  }
}
```

### Related Files

- `src/solve.mjs` - Main solve command
- `src/solve.repository.lib.mjs` - Repository cloning and management

## Root Cause 2: Orphaned Node.js Processes

### Description

When solve commands spawn child processes (Claude Code, git operations, npm install), these child processes can become orphaned if the parent terminates unexpectedly.

### Process Tree Problem

```
solve.mjs (PID 1000)
├── claude (PID 1001)
│   ├── mcp-server-playwright (PID 1002)
│   │   └── chrome-headless (PID 1003)
│   └── mcp-server-fetch (PID 1004)
└── npm install (PID 1005)
```

If PID 1000 is killed with SIGKILL:

- PID 1001-1005 become orphans (adopted by init)
- They continue running, consuming resources
- No cleanup signals are sent

### Signal Propagation Issue

```javascript
// Standard child process creation doesn't ensure cleanup
const child = spawn('claude', args, { detached: false });

// If parent killed, child may continue running
process.on('SIGTERM', () => {
  child.kill('SIGTERM'); // This won't run if parent gets SIGKILL
});
```

### Solution Pattern

```javascript
// Better: Use process groups
const child = spawn('claude', args, {
  detached: true,
  stdio: 'inherit',
});

// Track the process group
process.on('exit', () => {
  // Kill the entire process group
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (e) {
    // Process may already be dead
  }
});
```

## Root Cause 3: Zombie Processes

### Description

Zombie processes occur when a child process terminates but its parent hasn't called `wait()` to read the exit status.

### In Node.js Context

```javascript
// Child exits but parent doesn't handle the exit
const child = spawn('some-command');
child.on('exit', code => {
  // If this handler isn't properly defined or doesn't clean up
  // the child entry remains in process table
});
```

### Prevention

```javascript
// Ensure proper child process handling
const child = spawn('some-command');

child.on('exit', (code, signal) => {
  console.log(`Child exited with code ${code}`);
  // Process is reaped automatically after this handler
});

child.on('error', err => {
  console.error('Failed to start child:', err);
});
```

## Root Cause 4: Playwright MCP Chrome Leaks

### Description

This is extensively documented in [Issue #837 Case Study](../issue-837-playwright-mcp-chrome-leak/). The Playwright MCP server doesn't properly clean up Chrome processes.

### Key Points

1. `page.close()` doesn't actually close the browser tab
2. Browser contexts persist after session end
3. Chrome has upstream memory leaks on repeated open/close
4. No automatic process recycling

### Cross-Reference

See [../issue-837-playwright-mcp-chrome-leak/](../issue-837-playwright-mcp-chrome-leak/) for:

- Detailed root cause analysis
- Configuration recommendations (`--isolated` mode)
- Cleanup scripts

## Root Cause 5: No Automatic /tmp Cleanup

### Description

By default, Linux systems clean `/tmp` only on reboot or through `systemd-tmpfiles` with default 10-day retention. This is too long for active servers.

### Default systemd-tmpfiles Configuration

From `/usr/lib/tmpfiles.d/tmp.conf`:

```
# Clear tmp directories separately, to make them easier to override
q /tmp 1777 root root 10d
q /var/tmp 1777 root root 30d
```

This means files in `/tmp` are only cleaned if they haven't been accessed in 10 days - far too long for active solve operations.

### Problem

- Working directories are accessed during solve
- Even if solve finishes, the "last access" time is recent
- Files stay for 10 days before systemd cleans them

## Root Cause 6: Screen Session Loss on Reboot

### Description

The `hive-telegram-bot` runs in a GNU Screen session. Screen sessions are not persistent across reboots by default.

### Current Setup

```bash
# Current manual start
screen -S bot
hive-telegram-bot
# Ctrl+A, D to detach
```

### Why This Fails on Reboot

1. Screen stores session info in `/var/run/screen` or `/tmp/screens`
2. These are cleared on reboot
3. No systemd service to restart the bot
4. No @reboot cron job configured

### Impact

After reboot:

- Screen session "bot" doesn't exist
- Telegram bot is not running
- Users can't interact with the system via Telegram
- Manual intervention required

## Root Cause Summary

| Root Cause                           | Resource Affected    | Severity | Mitigation Difficulty |
| ------------------------------------ | -------------------- | -------- | --------------------- |
| Incomplete working directory cleanup | Disk                 | High     | Medium                |
| Orphaned Node.js processes           | CPU/RAM              | Medium   | Medium                |
| Zombie processes                     | Process table        | Low      | Low                   |
| Playwright Chrome leaks              | CPU/RAM              | High     | Medium                |
| No automatic /tmp cleanup            | Disk                 | High     | Low                   |
| Screen session loss on reboot        | Service availability | High     | Low                   |

## Prevention Strategies

### For Working Directory Cleanup

1. Use try/finally with robust cleanup
2. Implement cleanup-on-startup to remove stale directories
3. Configure systemd-tmpfiles with shorter retention

### For Process Management

1. Use process groups for subprocess trees
2. Implement SIGTERM handlers that propagate to children
3. Use proper process managers (PM2, systemd)

### For Chrome/Browser Processes

1. Use `--isolated` mode for Playwright MCP
2. Implement periodic browser recycling
3. Add cron job to kill orphaned chrome processes

### For Service Continuity

1. Create systemd service for hive-telegram-bot
2. Use Docker with restart policies
3. Implement health checks and auto-recovery
