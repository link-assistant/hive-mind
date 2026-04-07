# Case Study: Issue #1536 — Network Retry and Log Parity

## Timeline of Events

**Date:** 2026-04-07T05:54–06:01 UTC
**Target:** `labtgbot/gramflow` issue #1 (solve v1.46.6)
**Environment:** Docker sandbox (172.17.0.2), Node v20.20.2

### First Run (05:54:38)

1. **05:54:38** — `solve` starts against `labtgbot/gramflow#1`
2. **Visibility check** — `gh api repos/labtgbot/gramflow` returns HTTP 404 **and** `dial tcp … connection refused` (two different failures on two consecutive calls)
3. **Auto-accept-invite** — `gh api -X PATCH /user/repository_invitations/313762301` fails with `unexpected EOF`
4. **Fork creation** — `gh repo fork` returns HTTP 404 → immediate hard fail
5. **Exit** — "Repository setup failed - repository not accessible (HTTP 404)"

### Second Run (06:00:09)

1. **06:00:09** — Retried same command
2. **Visibility check** — First call succeeds (returns permissions JSON), second call fails with `dial tcp … connection refused`
3. **Auto-accept-invite** — Fails with `TLS handshake timeout`
4. **Auto-continue PR search** — `Post graphql: connection reset by peer`
5. **Get current user** — `Get /user: connection reset by peer` → **hard fail, exit**

### Error Summary

| Time | API Call | Error | Had Retry? |
|------|----------|-------|-----------|
| 05:54 | `repos/{o}/{r}` (visibility) | HTTP 404 | No |
| 05:54 | `repos/{o}/{r}` (visibility) | `connection refused` | No |
| 05:54 | `PATCH /user/repository_invitations/{id}` | `unexpected EOF` | No |
| 05:54 | `repos/{o}/{r}/forks` (fork) | HTTP 404 | No (correct for 404) |
| 06:00 | `repos/{o}/{r}` (visibility) | `connection refused` | No |
| 06:00 | `PATCH /user/repository_invitations/{id}` | `TLS handshake timeout` | No |
| 06:00 | `POST graphql` (PR search) | `connection reset by peer` | No |
| 06:00 | `GET /user` (current user) | `connection reset by peer` | No |

## Root Cause Analysis

### Problem 1: No retry on transient network errors (most gh commands)

The codebase has a generic `retry()` function in `lib.mjs` and an `isTransientNetworkError()` detector, but they are only used in:
- `validateForkParent()` in `solve.repository.lib.mjs` (added for issue #1311)
- `launchBotWithRetry()` in `telegram-bot-launcher.lib.mjs`
- PR verification loop in `solve.auto-pr.lib.mjs`

Most `gh api` and `gh` CLI calls execute without any retry logic. When GitHub's API is intermittently unreachable (TCP resets, TLS timeouts, DNS failures), a single failure causes the entire solve process to abort.

**Affected locations (from the log failures):**
1. `solve.accept-invite.lib.mjs` — `exec('gh api ...')` calls for invitations (lines 38, 46, 61, 71)
2. `solve.repository.lib.mjs:367` — `$\`gh api user --jq .login\`` (get current user)
3. `solve.mjs:244` — `$\`gh api repos/{o}/{r} --jq .permissions\`` (auto-fork check)
4. `github.lib.mjs:1440` — `$\`gh api repos/{o}/{r} --jq .visibility\`` (visibility check)

### Problem 2: Terminal/log output divergence

The `$` tagged template from `command-stream` captures both `stdout` and `stderr`. However:
- **stderr goes directly to terminal** (real-time process pipe)
- **Only `stdout` is typically processed** by the code and logged via `log()`
- **stderr is not logged** to the log file unless explicitly captured

This means:
- Terminal shows raw API error JSON like `{"message":"Not Found","documentation_url":"...","status":"404"}`
- Log file only shows the high-level message like "Warning: Could not detect repository visibility"
- Diagnostic information visible in terminal is lost in the log file

Additionally, `console.log()` / `console.error()` calls in some files bypass the `log()` function entirely, appearing in terminal but not in the log file.

## Solutions

### Solution 1: `ghRetry()` — Generic retry wrapper for gh commands

Create a `ghRetry()` utility in `lib.mjs` that:
- Wraps any async function that calls `gh` CLI
- Retries up to 3 times with exponential backoff (1s, 2s, 4s)
- Only retries on transient network errors (using existing `isTransientNetworkError()`)
- Logs retry attempts via `log()`
- Does NOT retry on 404, 403, 401 (non-transient)

### Solution 2: Apply `ghRetry()` to all critical gh command locations

Wrap the following with retry:
- `solve.accept-invite.lib.mjs`: All `exec()` calls for API requests
- `solve.repository.lib.mjs`: `gh api user --jq .login` in `setupRepository()`
- `solve.mjs`: Auto-fork permission check
- `github.lib.mjs`: `detectRepositoryVisibility()`

### Solution 3: Log stderr from command-stream `$` calls

Add a helper or modify the pattern so that when a `$` command fails (non-zero exit code), both stdout and stderr are logged to the log file, not just shown in terminal.
