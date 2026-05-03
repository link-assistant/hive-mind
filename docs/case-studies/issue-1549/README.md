# Case Study: Issue #1549 - Problems with fork PR processing

## Summary

When running `solve` on a cross-repository fork PR ([xlabtg/teleton-agent#170](https://github.com/xlabtg/teleton-agent/pull/170)), two distinct problems were observed:

1. **"Failed to get PR details" / "Unknown error"** - The solve command incorrectly rejects a valid PR response
2. **Terminal vs log file output discrepancy** - Some terminal output (e.g., raw JSON from `gh` CLI) does not appear in the log file

## Timeline of Events

1. User runs: `solve https://github.com/xlabtg/teleton-agent/pull/170 --attach-logs --verbose --no-tool-check --auto-accept-invite --tokens-budget-stats`
2. Solve v1.46.9 initializes, performs system checks (disk, memory, tool connections)
3. URL validation succeeds: identifies PR URL for `xlabtg/teleton-agent` PR #170
4. Repository access check: detects no write access, enables fork mode
5. Auto-accept-invite: no pending invitation found
6. Continue mode activated: sets PR number to 170
7. Fetches PR details via `gh pr view 170 --repo xlabtg/teleton-agent --json headRefName,body,...`
8. **gh CLI returns valid JSON** (exit code 0, stdout contains complete PR data)
9. **Bug triggers**: `ghPrView()` checks `stdout.includes('Could not resolve')` which matches text inside the PR body
10. `data` is set to `null` despite valid JSON response
11. Caller detects `!prResult.data` and logs "Error: Failed to get PR details"
12. `prResult.stderr` is empty, so "Error: Unknown error" is logged
13. Solve exits with code 1

## Root Cause Analysis

### Problem 1: False positive in "Could not resolve" detection

**Location**: `src/github.lib.mjs`, line 1331 (ghPrView) and line 1371 (ghIssueView)

**Root cause**: The function checks `!stdout.includes('Could not resolve')` against the **entire JSON response**, which includes the PR body field. PR #170's body contains a code example:

```ts
} catch (err) {
  log.debug({ err, msgId: msg.id }, "Could not resolve sender info");
}
```

The substring `"Could not resolve"` in this code example falsely triggers the error detection, causing the function to skip JSON parsing and return `data: null`.

**Before (buggy)**:

```javascript
if (code === 0 && stdout && !stdout.includes('Could not resolve')) {
```

**After (fixed)**:

```javascript
if (code === 0 && stdout && !(stderr && stderr.includes('Could not resolve'))) {
```

The fix checks only `stderr` for error messages, not `stdout` which contains the JSON response with PR/issue body text.

### Problem 2: Terminal vs log file output discrepancy

**Root cause**: The `command-stream` library (v0.9.4) defaults to `mirror: true` when using the `$` template literal. This means child process stdout/stderr are written directly to `process.stdout.write()` / `process.stderr.write()`, bypassing the `log()` function that writes to both terminal and log file.

**Specific data missing from log files**:

- Raw JSON output from `gh api` calls (e.g., `{"admin":false,"maintain":false,...}`)
- Raw text output from `gh api` calls (e.g., `public`)
- Any `process.stdout.write()` / `process.stderr.write()` direct calls
- `console.log()` calls that don't go through the `log()` function (except `[VERBOSE]` ones, which were already intercepted by issue #1466)

**Fix**: Added `setupStdioLogInterceptor()` that intercepts `process.stdout.write` and `process.stderr.write` to also append output to the log file. Uses a guard flag `_writingFromLog` to prevent double-logging when the `log()` function writes to the console (which internally calls `process.stdout.write`).

## Artifacts

- [solve-log-file.log](./solve-log-file.log) - The gist log from the failed run
- [terminal-output.txt](./terminal-output.txt) - Terminal output from the issue description (manually extracted)

## Affected Components

| Component        | File                      | Issue                                                               |
| ---------------- | ------------------------- | ------------------------------------------------------------------- |
| `ghPrView()`     | `src/github.lib.mjs:1331` | False positive "Could not resolve" detection in stdout              |
| `ghIssueView()`  | `src/github.lib.mjs:1371` | Same false positive pattern                                         |
| `log()`          | `src/lib.mjs:77`          | Does not capture non-log() terminal output                          |
| `command-stream` | External package          | `mirror: true` default sends output to terminal but not to log file |

## Solution

### Fix 1: ghPrView / ghIssueView false positive (Critical)

Changed the "Could not resolve" check from `stdout` to `stderr`. When `gh pr view` fails, the error message appears in stderr, not in the JSON response body on stdout.

### Fix 2: Terminal/log parity (Enhancement)

Added `setupStdioLogInterceptor()` in `src/lib.mjs` that:

1. Wraps `process.stdout.write` and `process.stderr.write`
2. Appends all terminal output to the log file with `[STDOUT]`/`[STDERR]` tags
3. Uses a guard flag to prevent double-logging from the `log()` function
4. Installed in both `solve.mjs` and `hive.mjs` alongside the existing verbose interceptor

## Verification

The fix was verified using `experiments/test-command-stream-pr-view.mjs` which:

1. Reproduces the original bug (proves `stdout.includes('Could not resolve')` matches PR body)
2. Shows the fix correctly parses the JSON when checking stderr instead

## Recommendations for command-stream

The `mirror: true` default in `command-stream` is convenient for interactive use but problematic for tools that need to capture and log all output. Consider:

1. Documenting `mirror` behavior more prominently
2. Adding a `create({ mirror: false })` factory recommendation for logging-sensitive applications
3. Adding an option to provide a custom write handler instead of just mirroring to process.stdout/stderr
