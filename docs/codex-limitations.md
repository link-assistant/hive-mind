# Codex Tool Limitations

## Network Restrictions

The Codex tool runs in a sandboxed environment with restricted network access for security reasons.

### What This Means

1. **Cannot Push to GitHub**: Codex cannot run `git push` directly
2. **Cannot Fetch External Resources**: Limited access to external APIs
3. **Cannot Run Network Commands**: Commands like `curl`, `wget` may fail

### How solve.mjs Handles This

The solve script works around these limitations:

1. **Initial Setup**: solve.mjs clones the repo and sets up the branch (before codex runs)
2. **Codex Execution**: Codex creates and modifies files, commits locally
3. **Auto-Restart**: If codex leaves uncommitted changes, solve.mjs restarts codex automatically
4. **Final Push**: After codex completes, solve.mjs pushes changes to GitHub (outside sandbox)

### Expected Workflow

```
[solve.mjs] Clone repo and create branch
            ↓
[codex]     Make changes and commit locally
            ↓
[solve.mjs] Detect uncommitted changes? → Restart codex
            ↓
[codex]     Commit remaining changes
            ↓
[solve.mjs] Push all commits to GitHub
            ↓
[solve.mjs] Exit successfully
```

### Troubleshooting

If you see "Could not resolve host: github.com" in codex output:
- ✅ This is expected and normal
- ✅ solve.mjs will handle the push after codex completes
- ⚠️  Don't interrupt with Ctrl+C - let the process complete

If solve.mjs doesn't push after codex completes:
- Check if you interrupted the process early
- Manually push: `git push origin <branch-name>`
- Report as a bug if it consistently fails

## Auto-Restart vs Watch Mode

### Auto-Restart (Temporary Monitoring)

When codex or other tools leave uncommitted changes, solve.mjs automatically enters "Auto-Restart Mode":

- **Purpose**: Complete unfinished work from the previous run
- **Trigger**: Uncommitted changes detected after tool execution
- **Duration**: Runs once, exits after changes are committed
- **NOT the same as**: User-requested `--watch` mode

**Example Output:**
```
🔄 AUTO-RESTART: Uncommitted changes detected
   Starting temporary monitoring cycle (NOT --watch mode)
   The tool will run once more to commit the changes
   Will exit automatically after changes are committed

🔄 AUTO-RESTART MODE ACTIVE
   Purpose: Complete unfinished work from previous run
   Monitoring PR: #123
   Mode: Temporary (NOT user-requested --watch)
```

### Watch Mode (Continuous Monitoring)

When you explicitly use `--watch`, solve.mjs continuously monitors for feedback:

- **Purpose**: Continuous monitoring for user feedback on PR
- **Trigger**: User specifies `--watch` flag
- **Duration**: Runs indefinitely until PR is merged or Ctrl+C
- **Use case**: Long-running monitoring for feedback

**Example Output:**
```
👁️ WATCH MODE ACTIVATED
   Checking interval: 60 seconds
   Monitoring PR: #123
   Stop condition: PR merged by maintainer
```

### Key Differences

| Feature | Auto-Restart | Watch Mode |
|---------|-------------|------------|
| Activation | Automatic (uncommitted changes) | Manual (`--watch` flag) |
| Duration | Single cycle | Continuous |
| Purpose | Finish incomplete work | Monitor for feedback |
| Exit Condition | Changes committed | PR merged or Ctrl+C |

## Common Issues

### Issue: "Watch mode activated but I didn't use --watch"

**Explanation**: This is Auto-Restart mode, not user-requested watch mode.

**Cause**: The tool left uncommitted changes that need to be handled.

**Solution**: Let the process complete. It will exit automatically after committing changes.

### Issue: "Codex can't push to GitHub"

**Explanation**: Codex runs in a sandboxed environment without network access.

**Cause**: Security restrictions in the Codex execution environment.

**Solution**: solve.mjs will automatically push changes after Codex completes. Don't interrupt the process.

### Issue: "Process seems stuck in watch mode"

**Explanation**: Either Auto-Restart is waiting for changes to be committed, or you used `--watch`.

**Debugging**:
1. Check the log messages - does it say "AUTO-RESTART MODE" or "WATCH MODE ACTIVATED"?
2. If Auto-Restart: Check if there are still uncommitted changes
3. If Watch Mode: You used `--watch` flag, wait for PR merge or press Ctrl+C

**Solution**:
- For Auto-Restart: Let it complete or commit changes manually
- For Watch Mode: Wait for completion or interrupt with Ctrl+C

## Related Documentation

- [Main README](../README.md) - General usage and features
- [Case Study: Issue #642](../case-studies/issue-642-codex-watch-mode-and-network/README.md) - Detailed analysis of watch mode behavior
