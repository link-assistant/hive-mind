# Case Study: Issue #1290 - Missing Auto-Restart Session Finish Report for `--tool agent`

## Issue Summary

When using `--tool agent` with `--attach-logs`, the auto-restart session does not report its completion with logs when it finishes (either with success or failure). This is inconsistent with `--tool claude` behavior.

## Timeline of Events

Based on the log file `solve-2026-02-14T08-28-31-968Z.log`:

1. **08:28:31** - `solve` starts with `--tool agent --model kimi-k2.5-free --attach-logs`
2. **08:28:58** - PR #778 is created on Jhon-Crow/godot-topdown-MVP
3. **08:29:05** - Agent execution begins (session `ses_3a4bb6d8dffeiS5FRAjqmkJinT`)
4. **08:33:25** - Agent session completes with "exiting loop" message
5. **08:33:26** - Agent command completes successfully
6. **08:33:35** - **First log upload**: "Solution draft log for PR #778" uploaded as Gist
7. **08:33:35** - Uncommitted changes detected (`?? pr_description.txt`)
8. **08:33:35** - AUTO-RESTART mode activated
9. **08:33:40** - Auto-restart 1/3 comment posted to PR
10. **08:33:41** - New agent session starts (session `ses_3a4b73b0effeFXKMNNCv1Lm3b2`)
11. **08:34:12** - **JSON Parse Error**: `AI_JSONParseError` occurs during streaming
12. **08:34:12** - Error type: `UsageLimit` detected
13. **08:34:12** - Agent tool execution fails with `Tool execution aborted`
14. **08:34:13** - Changes were already committed (detected clean git status)
15. **08:34:13** - Auto-restart mode exits - "CHANGES COMMITTED! Exiting auto-restart mode"
16. **08:34:13** - Changes pushed to remote branch
17. **08:34:13** - **NO FINAL REPORT/LOG UPLOAD** ❌

## Root Cause Analysis

Looking at the code flow:

### What happens with `--tool claude`:

When the auto-restart loop completes (lines 1368-1400 in `solve.mjs`), logs are uploaded:

```javascript
if (shouldAttachLogs && prNumber && !logsAlreadyUploaded) {
  await log('📎 Uploading working session logs to Pull Request...');
  // ... upload logic
}
```

### What happens with `--tool agent`:

The same code runs, but there are two issues:

1. **Per-iteration log upload in `solve.watch.lib.mjs`** (lines 277-324): This uploads logs after each successful auto-restart iteration.

2. **Missing final report when agent fails with error**: When the auto-restart session fails with a usage limit error (line 258 in `solve.watch.lib.mjs`):

   ```javascript
   await log(formatAligned('⚠️', `${argv.tool.toUpperCase()} execution failed`, 'Will retry in next check', 2));
   ```

   No logs are uploaded because:
   - The per-iteration log upload only happens on `toolResult.success` (line 261)
   - The final log upload at `solve.mjs:1370` is skipped because `logsAlreadyUploaded` flag behavior

3. **Specific issue**: In this case, the agent tool failed with `UsageLimit` error (JSON parse error), but the changes had already been committed. The code then detects "CHANGES COMMITTED" and exits the loop, but no final report is posted.

## The Gap

The gap is that when an auto-restart iteration fails (e.g., due to usage limit, API error, or other failure), but the overall goal is achieved (changes committed), there's no final report posted. The last comment on the PR is just the "Auto-restart 1/3" notification.

## Solution

Two fixes are needed:

1. **In `solve.watch.lib.mjs`**: Add log upload for failed iterations in auto-restart mode when `--attach-logs` is enabled.

2. **In `solve.mjs`**: Ensure the final log upload happens when auto-restart mode exits (either success or failure) with uncommitted changes resolved, regardless of whether individual iterations uploaded logs.

## PR Comments on #778 (Jhon-Crow/godot-topdown-MVP)

Only 2 comments exist:

1. `## 🤖 Solution Draft Log` - uploaded after first agent run
2. `## 🔄 Auto-restart 1/3` - notification about auto-restart starting

Missing:

- Final completion report after auto-restart finishes
- Log upload for the auto-restart session

## Fix Implementation

### Changes Made

1. **`src/solve.watch.lib.mjs`**:
   - Added log upload for failed auto-restart iterations (lines 281-319)
   - Added tracking variables `autoRestartIterationsRan` and `lastIterationLogUploaded`
   - Updated return value to include these flags

2. **`src/solve.mjs`**:
   - Updated final log upload condition to check `autoRestartRanButNotUploaded` (lines 1370-1375)
   - Ensures logs are uploaded when auto-restart ran but last iteration's logs weren't uploaded

### Key Logic

When an auto-restart iteration fails:

1. Upload failure logs immediately with a descriptive title (`⚠️ Auto-restart X/Y Failure Log`)
2. Include error information, usage limit details if applicable
3. Mark `lastIterationLogUploaded = true` on success

When auto-restart mode exits:

1. Check if iterations ran (`autoRestartIterationsRan`)
2. Check if last iteration's logs were uploaded (`lastIterationLogUploaded`)
3. If iterations ran but logs weren't uploaded, upload final logs

## References

- Log file: `solve-2026-02-14T08-28-31-968Z.log` (36426 lines)
- PR with issue: https://github.com/Jhon-Crow/godot-topdown-MVP/pull/778
- Auto-restart comment: https://github.com/Jhon-Crow/godot-topdown-MVP/pull/778#issuecomment-3901417953
