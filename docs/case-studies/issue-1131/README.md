# Case Study: Git Identity Configuration Corruption

**Issue**: [#1131 - Git identity configuration became corrupted](https://github.com/link-assistant/hive-mind/issues/1131)

**Status**: Fixed

**Date**: 2026-01-15

## Problem Description

The AI Issue Solver's `solve` command failed during automated work sessions with the error:

```
fatal: empty ident name (for <hive@vmi2955137.contaboserver.net>) not allowed
```

This error occurred when attempting to create git commits. The issue was traced to corrupted git global configuration (`~/.gitconfig`) where `user.name` and `user.email` were not set.

## Root Cause Analysis

### Timeline of Events

Based on analysis of solution draft logs from [PR #207](https://github.com/link-foundation/links-notation/pull/207):

| Session       | Date/Time            | Git Author                                        | Notes                              |
| ------------- | -------------------- | ------------------------------------------------- | ---------------------------------- |
| Session 1     | 2026-01-13T12:26     | `konard <drakonard@gmail.com>`                    | Working correctly                  |
| Session 2     | 2026-01-14T17:11     | `konard <drakonard@gmail.com>`                    | Working correctly                  |
| Session 3     | 2026-01-14T17:14     | `konard <drakonard@gmail.com>`                    | Working correctly                  |
| **Session 4** | **2026-01-15T02:50** | **Error occurred**                                | Git identity unknown               |
| Session 4     | 2026-01-15T02:50     | `AI Issue Solver <ai-solver@link-foundation.org>` | Claude self-fixed (local)          |
| Session 5     | 2026-01-15T07:56     | Error occurred                                    | Git identity unknown again         |
| Session 5     | 2026-01-15T07:56     | `Claude Opus 4.5 <noreply@anthropic.com>`         | Claude self-fixed (wrong identity) |

### What Happened

1. **Configuration Loss**: Between sessions 3 and 4 (between 2026-01-14T17:14 and 2026-01-15T02:50), the git global configuration was cleared or corrupted.

2. **First Self-Fix**: In session 4, when Claude encountered the error, it executed:

   ```bash
   git config user.email "ai-solver@link-foundation.org" && git config user.name "AI Issue Solver"
   ```

   This fixed the local repository but not the global configuration.

3. **Second Self-Fix (Wrong Identity)**: In session 5, working in a fresh clone, Claude encountered the same error and fixed it with:
   ```bash
   git config user.email "noreply@anthropic.com" && git config user.name "Claude Opus 4.5"
   ```
   This resulted in commits being attributed to "Claude Opus 4.5" instead of the intended identity.

### Root Cause (Updated: 2026-01-16)

**Deep investigation revealed the exact corruption mechanism:**

The git global configuration (`~/.gitconfig`) was replaced by a **broken symlink** pointing to a temporary directory that was later cleaned up.

#### Evidence from Logs

From the session log at `2026-01-15T02:53`:

```
lrwxrwxrwx  1 hive hive  49 Jan 15 00:11 .gitconfig -> /tmp/gh-issue-solver-1768432183293/git/.gitconfig
```

**Key findings:**

1. **Symlink Creation**: At `2026-01-15T00:11` (Jan 15 00:11 local = Jan 14 23:11 UTC), the `~/.gitconfig` file was replaced with a symlink
2. **Target Directory**: The symlink pointed to `/tmp/gh-issue-solver-1768432183293/git/.gitconfig` - a temp directory created at `2026-01-14T23:09:43 UTC`
3. **Temp Directory Cleanup**: When the solve session completed, the temp directory was cleaned up (normal behavior), leaving a broken symlink
4. **Error Manifestation**: Any subsequent session trying to read/write git config would fail because the symlink target no longer existed

#### Corruption Timeline Reconstruction

| Time (UTC)       | Event                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------- |
| 2026-01-14T23:09 | Solve session started, created temp directory `/tmp/gh-issue-solver-1768432183293`      |
| 2026-01-14T23:11 | Claude (during solve session) created symlink `~/.gitconfig -> temp_dir/git/.gitconfig` |
| Unknown          | Solve session completed, temp directory was cleaned up                                  |
| 2026-01-15T02:46 | Next solve session started on PR #207, immediately encountered git identity error       |

#### Why Did Claude Create the Symlink?

During a solve session around `2026-01-14T23:09 UTC`, Claude likely:

1. Encountered a git configuration issue
2. Attempted to "fix" it by creating a symlink to a config file in the current working directory
3. This was an incorrect fix because the temp directory is ephemeral

#### Additional PRs Analyzed

The following PRs were active around the corruption time and were investigated:

| PR                                                                 | Repository                     | Last Activity Before Corruption | Status                             |
| ------------------------------------------------------------------ | ------------------------------ | ------------------------------- | ---------------------------------- |
| [#1117](https://github.com/link-assistant/hive-mind/pull/1117)     | link-assistant/hive-mind       | 2026-01-14T17:09                | No corruption evidence             |
| [#207](https://github.com/link-foundation/links-notation/pull/207) | link-foundation/links-notation | 2026-01-14T17:14                | First session to detect corruption |
| [#1123](https://github.com/link-assistant/hive-mind/pull/1123)     | link-assistant/hive-mind       | Merged 2026-01-14T16:55         | Before corruption                  |

**Note**: The exact session that created the symlink could not be identified in the available logs. The session may have been on a different repository or the logs were not preserved.

## Impact

1. **Commit Attribution**: Some commits in PR #207 are incorrectly attributed to "Claude Opus 4.5" instead of "AI Issue Solver"
2. **Session Failures**: The solve command failed silently when git identity was missing, wasting compute time
3. **Inconsistent History**: The git history shows multiple different authors for automated work

## Solution

### Prevention Measures Implemented

1. **Pre-flight Check** (`src/solve.validation.lib.mjs`):
   Added git identity validation to `performSystemChecks()` that runs before any work begins:

   ```javascript
   const gitIdentity = await checkGitIdentity();
   if (!gitIdentity.isValid) {
     // Show detailed error message and fail early
   }
   ```

2. **Validation Library** (`src/git.lib.mjs`):
   Added `checkGitIdentity()` function that validates both `user.name` and `user.email` are configured.
   Added `repairGitIdentity()` function to automatically repair configuration using `gh-setup-git-identity --repair`.

3. **Auto-Repair Option** (`--auto-gh-configuration-repair`):
   Added a CLI option to automatically repair git configuration when it is corrupted:

   ```bash
   solve <issue-url> --auto-gh-configuration-repair
   ```

   When enabled, if git identity is not configured, the solve command will automatically attempt to repair it using `gh-setup-git-identity --repair`. This requires the [gh-setup-git-identity](https://github.com/link-foundation/gh-setup-git-identity) tool to be installed.

4. **Recovery Tool Reference**:
   The external `gh-setup-git-identity` utility sets git identity from the authenticated GitHub CLI account:

   ```bash
   gh-setup-git-identity        # Set identity globally
   gh-setup-git-identity --local # Set for current repo only
   gh-setup-git-identity --repair # Repair corrupted config without re-authentication
   ```

### Error Message

When git identity is not configured, users now see:

```
Git identity not configured

   Git commits require both user.name and user.email to be set.
   Git identity incomplete: missing user.name and user.email

   Current configuration:
     user.name:  (not set)
     user.email: (not set)

   How to fix:

   Option 1: Use GitHub CLI to set identity from your account
     gh-setup-git-identity

   Option 2: Set identity manually
     git config --global user.name "Your Name"
     git config --global user.email "you@example.com"

   Related error: "fatal: empty ident name (for <>) not allowed"
```

## Files Changed

| File                           | Description                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| `src/git.lib.mjs`              | Added `checkGitIdentity()`, `validateGitIdentity()`, and `repairGitIdentity()` functions |
| `src/solve.validation.lib.mjs` | Added git identity check and auto-repair logic to `performSystemChecks()`                |
| `src/solve.config.lib.mjs`     | Added `--auto-gh-configuration-repair` CLI option                                        |
| `tests/test-git-identity.mjs`  | Unit tests for identity validation and repair functions                                  |

**External Dependency**: The auto-repair feature requires [gh-setup-git-identity](https://github.com/link-foundation/gh-setup-git-identity) to be installed separately.

## Testing

Run the unit tests:

```bash
node tests/test-git-identity.mjs
```

Test the setup utility:

```bash
gh-setup-git-identity --dry-run --verbose
```

## References

- **Issue**: https://github.com/link-assistant/hive-mind/issues/1131
- **Related PR (links-notation)**: https://github.com/link-foundation/links-notation/pull/207
- **Related PR (hive-mind)**: https://github.com/link-assistant/hive-mind/pull/1117
- **Git Documentation**: https://git-scm.com/book/en/v2/Getting-Started-First-Time-Git-Setup
- **Stack Overflow**: [git "fatal: empty ident name not allowed"](https://bbs.archlinux.org/viewtopic.php?id=163624)

## Logs Archive

The following log files were analyzed and are preserved in `./logs/`:

| File                                   | Description                                                        |
| -------------------------------------- | ------------------------------------------------------------------ |
| `pr-1117-session-2026-01-14T17-09.txt` | PR #1117 session before corruption                                 |
| `pr-1117-session-2026-01-15T07-50.txt` | PR #1117 session after corruption (error session)                  |
| `pr-207-session-2026-01-14T17-14.txt`  | PR #207 last working session                                       |
| `pr-207-session-2026-01-15T02-53.txt`  | PR #207 first session after corruption (contains symlink evidence) |
| `pr-207-session-2026-01-15T08-02.txt`  | PR #207 subsequent session                                         |

## Lessons Learned

1. **Validate early**: Check all prerequisites before starting long-running processes
2. **Fail loudly**: When configuration is missing, show a clear error instead of attempting self-repair
3. **Provide recovery tools**: When an error can occur, provide easy ways to fix it
4. **Document the fix**: Include the related error message in help text so users can find solutions
5. **Never create symlinks to temp directories**: AI agents should be instructed not to create symlinks from persistent locations (like `~/.gitconfig`) to ephemeral locations (like `/tmp/`)
6. **Validate symlinks on startup**: System checks should detect broken symlinks in critical configuration files
