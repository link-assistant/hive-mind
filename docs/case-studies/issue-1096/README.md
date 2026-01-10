# Case Study: Issue #1096 - Logs Upload Failed

## Problem Statement

When the hive-mind system attempted to upload a solution draft log to GitHub via `gh-upload-log`, it failed with:

```
Error: File does not exist: "/tmp/solution-draft-log-pr-1768003849690.txt" --public --verbose
```

The error message shows that the CLI flags (`--public --verbose`) were incorrectly included as part of the filename argument, causing `gh-upload-log` to look for a non-existent file with that combined string as its name.

## Timeline of Events

| Timestamp           | Event                                                        |
| ------------------- | ------------------------------------------------------------ |
| 2026-01-09 23:52:55 | solve.mjs started processing issue #1083                     |
| 2026-01-09 23:53:34 | PR #1090 created as draft                                    |
| 2026-01-10 00:10:48 | Solution completed, attempting to upload log                 |
| 2026-01-10 00:10:49 | Log too long (1,174,742 chars), GitHub limit is 65,536 chars |
| 2026-01-10 00:10:49 | Sanitization completed (5 secrets masked)                    |
| 2026-01-10 00:10:51 | **gh-upload-log FAILED** with argument parsing error         |
| 2026-01-10 00:10:51 | Fallback to truncated comment initiated                      |
| 2026-01-10 00:10:54 | Truncated log uploaded successfully (1156KB)                 |
| 2026-01-10 00:10:54 | Process reported as successful (but log was truncated)       |

## Root Cause Analysis

### Primary Root Cause: command-stream Template Literal Argument Handling

The bug is in `src/log-upload.lib.mjs` at line 52:

```javascript
// BUGGY CODE:
const commandArgs = [`"${logFile}"`, publicFlag];
if (verbose) {
  commandArgs.push('--verbose');
}
const uploadResult = await $`gh-upload-log ${commandArgs.join(' ')}`;
```

**The Problem:** When using `command-stream`'s `$` template tag, a single template interpolation (`${commandArgs.join(' ')}`) is treated as a **single argument**, regardless of internal spaces. This means:

1. `commandArgs.join(' ')` produces: `"/tmp/file.txt" --public --verbose`
2. The entire string becomes the **first positional argument** to `gh-upload-log`
3. `gh-upload-log` interprets this as the file path, leading to the error

### Evidence from Logs

The displayed command showed (line 7869):

```
Running: gh-upload-log "/tmp/solution-draft-log-pr-1768003849690.txt" --public --description "..." --verbose
```

But the actual error showed (line 7872):

```
Error: File does not exist: "/tmp/solution-draft-log-pr-1768003849690.txt" --public --verbose
```

Note: The `--description` flag was missing from the error because it was never included in `commandArgs` (only in the display command).

### Secondary Issue: Description Flag Not Passed

The code builds a display command including `--description` (line 41):

```javascript
const command = `gh-upload-log "${logFile}" ${publicFlag} ${descFlag} ${verboseFlag}`;
```

But the actually executed command (line 52) uses `commandArgs` which doesn't include `descFlag`:

```javascript
const commandArgs = [`"${logFile}"`, publicFlag];
```

This means the description is never actually sent to `gh-upload-log`.

## Solution

### Fix 1: Use Separate Template Interpolations

Replace the single joined interpolation with individual interpolations:

```javascript
// FIXED CODE:
const publicFlag = isPublic ? '--public' : '--private';
const verboseFlag = verbose ? '--verbose' : '';

const uploadResult = await $`gh-upload-log ${logFile} ${publicFlag} ${verboseFlag}`;
```

Each `${}` interpolation is properly handled as a separate argument by command-stream.

### Fix 2: Include Description Flag

```javascript
const descFlag = description ? ['--description', description] : [];
// Then use spread operator or multiple interpolations
```

## Testing

### Reproduction Test

```javascript
// This reproduces the bug:
const commandArgs = [`"${logFile}"`, '--public', '--verbose'];
const uploadResult = await $`gh-upload-log ${commandArgs.join(' ')}`;
// Result: gh-upload-log receives entire string as file path
```

### Verification Test

```javascript
// This works correctly:
const uploadResult = await $`gh-upload-log ${logFile} --public --verbose`;
// Result: arguments are properly parsed
```

## Files in This Case Study

- `README.md` - This document
- `full-log.txt` - Complete log from the failed execution (7891 lines)

## Related Links

- Original Issue: https://github.com/link-assistant/hive-mind/issues/1096
- Pull Request: https://github.com/link-assistant/hive-mind/pull/1097
- gh-upload-log Tool: https://github.com/link-foundation/gh-upload-log
- Previous Case Study: Issue #587 (large file upload limitations)

## Lessons Learned

1. **Template literals in shell commands require careful handling**: Each `${}` interpolation in command-stream is treated as a single argument. Don't join multiple arguments into one string.

2. **Display vs execution divergence is dangerous**: The code displayed one command but executed a different one, making debugging harder.

3. **Log truncation should be considered a failure**: The "successful" completion masked the actual upload failure. Truncated logs lose critical debugging information.

4. **Tests should verify actual command execution**: The existing tests verified argument building logic but didn't test actual command execution with command-stream.
