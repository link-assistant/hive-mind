# Case Study: Auto-Cleanup and Service Auto-Restart Solutions (Issue #912)

## Executive Summary

The Hive Mind server infrastructure experiences gradual resource degradation due to:
1. **CPU waste**: Dangling processes from `solve` and `hive` command executions
2. **RAM waste**: Zombie processes that don't get properly reaped
3. **Disk waste**: Temporary files accumulating in `/tmp` from repository clones and AI tool operations

This leads to service degradation and eventually the `solve` command stops working when system resources are exhausted. The current manual workaround is a server reboot, which requires careful timing to avoid interrupting running commands and loses the `hive-telegram-bot` session running in GNU Screen.

## Problem Description

### Observed Symptoms

1. **Disk Space Exhaustion**: The `/tmp` directory fills up with:
   - Cloned Git repositories for issue solving
   - Temporary files from Claude Code MCP tools
   - Log files from command executions
   - NPM/node_modules caches

2. **Process Accumulation**:
   - Child processes spawned by solve/hive commands that don't terminate properly
   - Orphaned Node.js processes when parent commands fail
   - Browser processes from Playwright MCP (as documented in Issue #837)

3. **Service Unavailability**:
   - When disk is full: `Error: ENOSPC: no space left on device`
   - When RAM is exhausted: OOM killer terminates processes
   - System becomes unresponsive with high load average

### Current Workaround

```bash
# Current manual process:
# 1. Wait for all solve/hive commands to finish
# 2. Reboot the server
sudo reboot
```

**Problems with this approach:**
- Kills the `hive-telegram-bot` running in `screen -r bot`
- Requires manual restart of the bot after reboot
- No automated detection of "safe to reboot" state
- No automatic restart of services after reboot

## Impact Assessment

### Resource Impact

| Resource | Normal State | Degraded State | Impact |
|----------|--------------|----------------|--------|
| Disk (/tmp) | < 50% used | 100% used | Commands fail to clone repos |
| RAM | < 70% used | > 95% used | OOM kills processes |
| CPU Load | < 4.0 | > 20.0 | System unresponsive |
| Process Count | < 200 | > 500 | Process table exhaustion |

### Operational Impact

- **Service Degradation**: Solve commands fail silently or with cryptic errors
- **Manual Intervention Required**: Operations team must monitor and reboot
- **Service Interruption**: Telegram bot becomes unavailable during reboot
- **Data Loss Risk**: In-progress operations may be lost during forced reboot

### Business Impact

- **Reduced Automation Reliability**: Automated issue solving becomes inconsistent
- **Increased Operational Overhead**: Manual monitoring and intervention needed
- **User Experience**: Bot unavailability affects users relying on Telegram interface
- **SLA Violations**: If uptime commitments exist

## Requirements for Solution

### Must Have

1. **Auto-restart telegram bot after reboot**: The `hive-telegram-bot` must automatically start when the system boots
2. **Safe reboot mechanism**: Only reboot when no solve/hive commands are running
3. **Automatic resource cleanup**: Periodic cleanup of `/tmp` and orphaned processes

### Should Have

1. **Health monitoring**: Alert when resources reach critical thresholds
2. **Graceful degradation**: New tasks queued when resources low, not failed
3. **Log preservation**: Important logs archived before cleanup

### Could Have

1. **Auto-scaling**: Spawn additional instances during high load
2. **Container isolation**: Each solve command in isolated container
3. **Distributed execution**: Load balancing across multiple servers

## Proposed Solution Categories

### 1. Service Auto-Restart (Addressing Bot Restart)
- **systemd service**: Native Linux service management with auto-restart
- **Docker Compose**: Container-based deployment with restart policies

### 2. Resource Cleanup (Addressing CPU/RAM/Disk Waste)
- **Cron jobs**: Scheduled cleanup of `/tmp` and orphaned processes
- **systemd-tmpfiles**: Native systemd mechanism for temporary file management
- **Process supervision**: Proper process lifecycle management

### 3. Safe Reboot Mechanism (Addressing Timing)
- **Lock file mechanism**: Solve/hive commands create locks that prevent reboot
- **Active session detection**: Check for running screen sessions before reboot
- **Scheduled maintenance windows**: Predictable reboot times with notification

### 4. Container-Based Solution (Comprehensive)
- **Docker deployment**: Full containerization with resource limits
- **Restart policies**: `unless-stopped` or `always` for reliability
- **Volume management**: Proper handling of persistent data

## Next Steps

1. Review detailed technical analysis in [02-ROOT-CAUSES.md](./02-ROOT-CAUSES.md)
2. Evaluate proposed solutions in [03-SOLUTIONS.md](./03-SOLUTIONS.md)
3. Follow implementation guide in [04-IMPLEMENTATION.md](./04-IMPLEMENTATION.md)
4. Choose solution based on infrastructure constraints and team expertise
