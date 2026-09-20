# Case Study: Issue #1552 - /solve command should immediately fail on non-existent issues

## Summary

When a user runs `/solve https://github.com/1Anastasios1/Magic-Quintet/issues/2 --tool agent` in the Telegram bot, the command starts successfully even though issue #2 does not exist in the `1Anastasios1/Magic-Quintet` repository. The bot should validate GitHub entity existence and fail immediately, before spawning any solve session.

## Timeline of Events

1. User sends `/solve https://github.com/1Anastasios1/Magic-Quintet/issues/2 --tool agent` in Telegram group
2. Telegram bot validates URL format - passes (URL is syntactically correct)
3. Telegram bot validates model, branch, flags - all pass
4. Bot sends "Solve command started successfully!" message
5. Solve session spawns, consuming resources (screen session, disk, API tokens)
6. Session eventually fails deep in execution when trying to fetch issue details
7. Resources were wasted on a task that could have been rejected immediately

## Root Cause Analysis

### Problem: No entity existence check before execution

The `/solve` command in `telegram-bot.mjs` validates:

- URL **format** (is it a valid GitHub issue/PR URL?)
- Command **options** (model name, branch name, isolation backend, yargs config)
- Queue **availability** (duplicates, resource limits)

But it does **not** check whether the referenced GitHub entities actually exist:

- Does the **user/organization** (`1Anastasios1`) exist?
- Does the **repository** (`Magic-Quintet`) exist and is it accessible?
- Does the **issue** (`#2`) exist?

Similarly, `solve.mjs` validates:

- URL format
- System resources (disk, memory)
- Tool connections (Claude CLI)
- GitHub authentication and permissions

But also does **not** check entity existence until deep in execution when it tries to fetch issue details.

### Why this matters

1. **Wasted resources**: A solve session consumes screen sessions, disk space, and API tokens (Claude, GitHub)
2. **Delayed feedback**: User only learns about the failure after minutes of processing
3. **Poor UX**: "Solve command started successfully!" is misleading when the target doesn't exist
4. **Auto-accept-invite complication**: When `--auto-accept-invite` is enabled, we need to try accepting invitations before checking entity existence, since the repo might become accessible after accepting

## Requirements from Issue

1. Check **user/organization** existence - fail with message immediately
2. Check **repository** existence - fail with message, prompt user to check if it exists or if private to check permissions
3. Check **issue/PR** existence - fail with message immediately
4. Handle `--auto-accept-invite`: try accepting invitations before checking (but only enough to process the requested link)
5. Fail at **telegram bot level** immediately (before queueing/starting session)
6. Also fail at **solve command level** (for non-telegram invocations)

## Solution

### New function: `validateGitHubEntityExistence()`

**Location**: `src/github.lib.mjs`

Validates entities in hierarchical order using GitHub API:

1. **User/org**: `gh api users/{owner}` - checks if the account exists
2. **Repository**: `gh api repos/{owner}/{repo}` - checks if the repo exists and is accessible
3. **Issue/PR**: Uses existing `ghIssueView()` / `ghPrView()` functions

Key design decisions:

- Checks entities **in order** (user -> repo -> issue/PR), failing fast at the first missing entity
- **Only blocks on 404 errors** - network/auth errors are logged but don't prevent execution (to avoid false positives)
- Provides **helpful suggestions** (e.g., "Did you mean the issue URL?" when PR doesn't exist but issue does)
- Uses `ghCmdRetry` for transient error resilience (consistent with issue #1536 patterns)

### Integration points

1. **`src/telegram-bot.mjs`** (line ~993): After URL + options validation, before queueing
   - If `--auto-accept-invite` is in args, runs `autoAcceptInviteForRepo()` first
   - Then calls `validateGitHubEntityExistence()`
   - Fails immediately with error message to user

2. **`src/solve.mjs`** (line ~312): After `autoAcceptInviteForRepo()`, before write permission check
   - Validates entities before any expensive operations (cloning, AI tokens)
   - Exits with clear error message

## Affected Components

| Component         | File                                    | Change                                         |
| ----------------- | --------------------------------------- | ---------------------------------------------- |
| Entity validation | `src/github.lib.mjs`                    | New `validateGitHubEntityExistence()` function |
| Telegram /solve   | `src/telegram-bot.mjs`                  | Added entity check before queueing             |
| Solve CLI         | `src/solve.mjs`                         | Added entity check after auto-accept-invite    |
| Tests             | `tests/test-entity-validation-1552.mjs` | 13 unit tests for validation logic             |

## Test Coverage

13 unit tests covering:

- Non-existent user/organization detection
- Non-existent repository detection
- Non-existent issue detection
- Non-existent PR detection
- Issue/PR cross-suggestion (suggests issue when PR missing and vice versa)
- Successful validation for all entity types
- Graceful handling of non-404 errors (network, auth)
- Hierarchical validation order
- Validation without issue number (repo-level only)

## Before/After Behavior

### Before (buggy)

```
User: /solve https://github.com/1Anastasios1/Magic-Quintet/issues/2 --tool agent
Bot:  ✅ Solve command started successfully!
      📊 Session: solve-1Anastasios1-Magic-Quintet-2
      ... (minutes later) ... fails deep in execution
```

### After (fixed)

```
User: /solve https://github.com/1Anastasios1/Magic-Quintet/issues/2 --tool agent
Bot:  ❌ Issue #2 does not exist in 1Anastasios1/Magic-Quintet.
      💡 Please check:
      • The issue number is correct
      • The issue has not been deleted or transferred
```
