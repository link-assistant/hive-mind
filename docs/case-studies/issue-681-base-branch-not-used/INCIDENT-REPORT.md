# Incident Report: Base Branch Ignored During Branch Creation

## Incident Summary

**Date**: 2025-11-05
**Reported by**: konard
**Issue**: https://github.com/deep-assistant/hive-mind/issues/681
**Severity**: High
**Status**: Documented - Fix pending

## What Happened

The `solve` command was executed with `--base-branch feat/perf.t` to create a pull request from a feature branch:

```bash
solve https://github.com/uselessgoddess/bar/issues/5 \
  --base-branch feat/perf.t \
  --auto-fork \
  --auto-continue \
  --attach-logs \
  --verbose \
  --no-tool-check
```

### Expected Behavior

1. Create new issue branch `issue-5-f81abcbe3f46` FROM `feat/perf.t`
2. The new branch should only contain commits from `feat/perf.t`
3. Create pull request targeting `feat/perf.t`
4. PR should show only new changes added by the solve session

### Actual Behavior

1. Created new issue branch `issue-5-f81abcbe3f46` FROM `main` (wrong!)
2. The new branch contained ALL commits from `main`, not just from `feat/perf.t`
3. Created pull request targeting `feat/perf.t` (correct)
4. PR showed commits from `main` that weren't in `feat/perf.t` (polluted)

### Impact

- **Pull Request #6** (https://github.com/uselessgoddess/bar/pull/6) contains unrelated commits
- The diff includes changes that were never intended to be in this PR
- The PR is difficult to review because it mixes intended changes with unrelated history
- User lost time and confidence in the tool's reliability

## Timeline

### 2025-11-05 14:36:12 UTC - Command Execution

```
[INFO] /home/hive/.nvm/versions/node/v20.19.5/bin/node /home/hive/.bun/bin/solve
       https://github.com/uselessgoddess/bar/issues/5
       --base-branch feat/perf.t --auto-fork --auto-continue --attach-logs --verbose --no-tool-check
```

### 2025-11-05 14:36:31 UTC - Repository Setup

```
[INFO] ℹ️ Default branch:           main
[INFO] ✅ Default branch synced:    with upstream/main
[INFO] 🔄 Pushing to fork:          main branch
📌 Default branch:           main
```

### 2025-11-05 14:36:31 UTC - Branch Creation (BUG OCCURRED)

```
🌿 Creating branch:          issue-5-f81abcbe3f46 from main
```

**THIS IS THE BUG**: Log says "from main" even though user specified `--base-branch feat/perf.t`

### 2025-11-05 14:36:37 UTC - Base Branch Recognition

```
[INFO] All GitHub branches: feat/api, feat/cli, feat/perf.t, feat/perf, main...
```

System is aware that `feat/perf.t` exists.

### 2025-11-05 14:36:42 UTC - PR Creation Logic Correctly Used Base Branch

```
[INFO] 🔄 Fetching:                 Latest feat/perf.t branch...
[INFO] ✅ Base updated:             Fetched latest feat/perf.t
[INFO] Commits ahead of origin/feat/perf.t: 1
[INFO] 🎯 Target branch:            feat/perf.t (custom)
```

**PR creation logic worked correctly** - it fetched and targeted `feat/perf.t`.

### 2025-11-05 14:36:42 UTC - PR Created with Correct Target

```
Command: gh pr create --draft ... --base feat/perf.t --head konard:issue-5-f81abcbe3f46
```

**PR correctly targets `feat/perf.t`**, but the branch history is wrong.

### Later - Issue Reported

User noticed the PR contained commits that shouldn't be there and reported issue #681.

## Root Cause

The bug is in `src/solve.branch.lib.mjs:133`:

```javascript
// Line 129: Logs that it's creating from defaultBranch
await log(`\n${formatAligned('🌿', 'Creating branch:', `${branchName} from ${defaultBranch}`)}`);

// Line 133: But git command doesn't specify a base branch at all!
checkoutResult = await $({ cwd: tempDir })`git checkout -b ${branchName}`;
```

When `git checkout -b` is called without a start point, it creates the branch from current HEAD, which was `main`.

## Why It Went Unnoticed

1. **Misleading Log Message**: The log says "from main" which makes it look intentional
2. **PR Creation Worked**: The PR correctly targeted the base branch, masking the issue
3. **Incomplete Testing**: No automated tests for `--base-branch` branch creation
4. **Partial Implementation**: The option was added but branch creation wasn't updated

## Evidence from Logs

### Evidence 1: Command Line Arguments

From `first-session-log.txt:10`:

```
--base-branch feat/perf.t
```

User clearly specified the base branch.

### Evidence 2: Branch Created from Main

From `first-session-log.txt:73`:

```
🌿 Creating branch:          issue-5-f81abcbe3f46 from main
```

Should say "from feat/perf.t" but says "from main".

### Evidence 3: PR Correctly Targeted

From `first-session-log.txt:143`:

```
🎯 Target branch:            feat/perf.t (custom)
```

PR creation logic correctly recognized the custom base branch.

### Evidence 4: Git Command Used

From `first-session-log.txt:164`:

```
gh pr create --draft ... --base feat/perf.t --head konard:issue-5-f81abcbe3f46
```

PR was created with correct base, but branch history was already wrong by this point.

## Files Involved

### Primary Files

1. **src/solve.branch.lib.mjs** - Contains the bug (line 133)
2. **src/solve.mjs** - Calls the buggy function (line 501)
3. **src/solve.config.lib.mjs** - Defines the CLI option (line 178)
4. **src/solve.auto-pr.lib.mjs** - PR creation (works correctly)

### Configuration Files

- `package.json` - Dependencies and scripts
- `.github/workflows/*` - CI configuration (if any)

## Impact Assessment

### Users Affected

- All users who use `--base-branch` option
- Teams using feature branch workflows
- Projects with multiple long-lived branches

### Data/Code Integrity

- No data loss
- No code corruption
- Pull requests contain extra commits but are still valid git operations
- Can be fixed by recreating branches from correct base

### Workarounds Available

1. **Manual branch creation**:

   ```bash
   cd /tmp/gh-issue-solver-*
   git checkout -b issue-X-xxx origin/feat/perf.t
   git push -u origin issue-X-xxx
   # Then run solve in continue mode
   ```

2. **Accept the PR pollution**:
   - Reviewer can see which commits are intended vs unintended
   - Not ideal but doesn't break functionality

3. **Close and recreate PR**:
   - Close the polluted PR
   - Manually create branch from correct base
   - Create new PR with clean history

## Lessons Learned

### What Went Wrong

1. Feature added to CLI but not fully integrated
2. Log message didn't match actual behavior
3. No automated tests for this specific use case
4. Variable naming was ambiguous (`defaultBranch` vs user's choice)

### What Went Right

1. User reported issue with clear evidence (PR link)
2. Logs were available for debugging (via gist)
3. PR creation logic was implemented correctly
4. Issue was caught before widespread deployment

### Process Improvements

1. **Comprehensive Testing**: Add tests for all CLI options
2. **Code Review Focus**: Review git operations carefully
3. **Integration Tests**: Test real-world workflows end-to-end
4. **Logging Validation**: Ensure logs reflect actual operations
5. **Clear Variable Names**: Use descriptive names to avoid confusion

## Action Items

### Immediate (Critical)

- [ ] Fix branch creation command to use base branch
- [ ] Add validation for base branch existence
- [ ] Test fix with multiple scenarios
- [ ] Release patch version

### Short Term (Important)

- [ ] Add automated tests for `--base-branch` option
- [ ] Update documentation with clear examples
- [ ] Review other git operations for similar issues
- [ ] Add integration test suite

### Long Term (Improvement)

- [ ] Refactor variable naming for clarity
- [ ] Add linting rules for git operations
- [ ] Improve error messages for common mistakes
- [ ] Create comprehensive test repository

## References

- **Issue**: https://github.com/deep-assistant/hive-mind/issues/681
- **Affected PR**: https://github.com/uselessgoddess/bar/pull/6
- **First Session Log**: [first-session-log.txt](./first-session-log.txt)
- **Second Session Log**: [second-session-log.txt](./second-session-log.txt)
- **Root Cause Analysis**: [ROOT-CAUSE-ANALYSIS.md](./ROOT-CAUSE-ANALYSIS.md)
- **Proposed Solutions**: [PROPOSED-SOLUTIONS.md](./PROPOSED-SOLUTIONS.md)

## Incident Classification

**Type**: Logic Error / Incomplete Implementation
**Category**: Git Operations / Branch Management
**Severity**: High (affects core functionality)
**Detectability**: Medium (users notice when reviewing PRs)
**Recovery**: Easy (can recreate branches correctly)

## Sign-off

**Investigated by**: AI Issue Solver (Claude)
**Date**: 2025-11-05
**Status**: Root cause identified, solutions proposed
**Next Steps**: Implement fix and deploy
