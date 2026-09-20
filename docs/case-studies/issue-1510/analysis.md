# Case Study: Issue #1510 — Activity timeout force-kills legitimate long-running sessions

## Summary

The `streamActivityMs` timeout (300s / 5 minutes) force-killed a Claude Code session that was
legitimately waiting for a long-running Bash command (`sleep 300 && gh run view ...`) to complete.
The session was killed 3 times in a row, each time auto-resuming with `--resume`, but hitting the
same timeout again because Claude kept trying to poll the same CI job.

## Timeline of Events

| Time (UTC)          | Event                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------- |
| 2026-03-30 22:44:44 | Session starts, solving issue link-foundation/sandbox#74                               |
| 2026-03-30 22:44:54 | Branch `issue-74-16806f8cb5df` created, initial commit pushed                          |
| 2026-03-30 22:45:30 | Session ID assigned: `d9028d55-b9f1-4d4d-b316-97adbe2fe485`                            |
| 2026-03-30 22:49:19 | Last stdout activity — API response parsed (status 200)                                |
| 2026-03-30 22:54:14 | **TIMEOUT #1**: No stream output for 300s → force-kill (SIGTERM+SIGKILL)               |
| 2026-03-30 22:54:44 | Retry 1/10 with `--resume d9028d55...` (30s delay, session preserved)                  |
| 2026-03-30 22:54:50 | Session resumed successfully                                                           |
| ~23:05:51           | Last stdout activity before timeout #2                                                 |
| 2026-03-30 23:10:51 | **TIMEOUT #2**: No stream output for 300s → force-kill                                 |
| 2026-03-30 23:11:51 | Retry 2/10 with `--resume d9028d55...` (1 min delay)                                   |
| 2026-03-30 23:11:53 | Session resumed                                                                        |
| 2026-03-30 23:14:23 | Claude executes `sleep 300 && gh run view 23771690336 ...` (explicit 5min wait for CI) |
| 2026-03-30 23:19:23 | **TIMEOUT #3**: No stream output for 300s → force-kill during the sleep command        |
| 2026-03-30 23:21:23 | Retry 3/10 attempted but session ended with CTRL+C                                     |
| 2026-03-30 23:21:37 | Log uploaded, session marked as interrupted                                            |

## Root Causes

### 1. Activity timeout too short (300s) for legitimate operations

The `HIVE_MIND_STREAM_ACTIVITY_MS` default is 300000ms (5 minutes). Claude Code can legitimately
wait for operations that take longer than 5 minutes:

- Docker builds (often 10-30+ minutes)
- CI/CD pipeline polls (explicit `sleep 300` + check)
- Large package installations
- Long compilation tasks

### 2. `lastEventTime` not updated outside `interactiveHandler` block

In `claude.lib.mjs:930`, `lastEventTime = Date.now()` is only set inside the
`if (interactiveHandler)` block. When no interactive handler is active (normal mode),
`lastEventTime` stays `null`, causing the idle seconds display to always show `unknowns`
(the string `'unknown'` + the `'s'` suffix from the template literal).

### 3. No session-end/start PR comments on force-kill + auto-resume

When a session is force-killed and auto-resumed, there is no comment posted to the PR marking:

- The end of the interrupted session (with reason and partial log)
- The start of the resumed session

This makes it hard for human reviewers to understand what happened.

## Bugs Found

1. **Critical**: Activity timeout (300s) is too short — should be at least 1 hour (3600s)
2. **Bug**: `lastEventTime` never set in non-interactive mode → `idle: unknowns` in logs
3. **Cosmetic**: `idle: ${idleSeconds}s` produces `idle: unknowns` when unknown (should be `idle: unknown`)

## Solutions Implemented

1. Increase `streamActivityMs` default from 300000ms (5 min) to 3600000ms (1 hour)
2. Move `lastEventTime = Date.now()` outside the `interactiveHandler` block so it always updates
3. Fix the cosmetic `unknowns` → `unknown` display issue
4. Add PR comments marking force-killed session end and auto-resume start

## Related Issues

- Issue #1472: Original idle timeout detection implementation
- Issue #1475: Startup timeout implementation
- Issue #1280: Result stream close timeout
- Issue #1346: SIGTERM + SIGKILL two-stage kill

## Log File

- Full log: `d9028d55-b9f1-4d4d-b316-97adbe2fe485.log` (in this directory)
- Original gist: https://gist.githubusercontent.com/konard/5ff8ebb1b6146a0f30c1e071979900fe/raw/fdddac7e5c9b8857178d30bff519c904f4504f09/d9028d55-b9f1-4d4d-b316-97adbe2fe485.log
