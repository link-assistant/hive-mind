# Case Study Index: Issue #681 - Base Branch Not Used

## Quick Navigation

### Overview Documents

- [README.md](./README.md) - High-level overview of the issue
- [INCIDENT-REPORT.md](./INCIDENT-REPORT.md) - Detailed incident timeline and impact

### Technical Analysis

- [ROOT-CAUSE-ANALYSIS.md](./ROOT-CAUSE-ANALYSIS.md) - Deep dive into the bug's technical details
- [PROPOSED-SOLUTIONS.md](./PROPOSED-SOLUTIONS.md) - Recommended fixes and preventive measures

### Raw Data

- [first-session-log.txt](./first-session-log.txt) - Complete log of initial solve session (422KB, 8614 lines)
- [second-session-log.txt](./second-session-log.txt) - Complete log of auto-restart session (699KB, 15056 lines)

## Document Purpose Summary

### README.md

**Purpose**: Entry point for understanding the issue
**Audience**: All stakeholders (developers, users, managers)
**Content**:

- Problem statement
- Evidence from logs
- Root cause summary
- Impact assessment

### INCIDENT-REPORT.md

**Purpose**: Formal incident documentation
**Audience**: Project managers, team leads, stakeholders
**Content**:

- Detailed timeline of events
- Impact on users and system
- Lessons learned
- Action items and sign-off

### ROOT-CAUSE-ANALYSIS.md

**Purpose**: Technical investigation for developers
**Audience**: Developers, code reviewers, maintainers
**Content**:

- Code-level analysis
- Data flow tracing
- Comparison of expected vs actual behavior
- Technical explanation of the bug

### PROPOSED-SOLUTIONS.md

**Purpose**: Fix recommendations and preventive measures
**Audience**: Developers implementing the fix
**Content**:

- Immediate fix (code changes)
- Additional improvements
- Testing plan
- Migration strategy
- Preventive measures

## Key Findings

### The Bug

The `--base-branch` option was ignored during branch creation. The tool created branches from the repository's default branch (main) instead of the user-specified base branch.

### Why It Happened

1. Incomplete implementation of the `--base-branch` feature
2. Git command missing the base branch parameter: `git checkout -b <name>` instead of `git checkout -b <name> <base>`
3. Misleading log messages that suggested correct behavior
4. No automated tests for this scenario

### Impact

- **Severity**: High
- **Affected Users**: All users of the `--base-branch` option
- **Symptoms**: Pull requests contain unrelated commits from main branch
- **Workaround**: Available but inconvenient

### Fix Complexity

- **Difficulty**: Low
- **Risk**: Low
- **Testing**: Straightforward
- **Deployment**: Can be released immediately as patch

## Code Locations

### Bug Location

- **File**: `src/solve.branch.lib.mjs`
- **Function**: `createOrCheckoutBranch`
- **Line**: 133
- **Issue**: Missing base branch parameter in `git checkout -b` command

### Related Code

- `src/solve.mjs:501` - Calls the buggy function
- `src/solve.config.lib.mjs:178` - Defines CLI option
- `src/solve.auto-pr.lib.mjs:655` - PR creation (works correctly)

## Timeline Summary

| Time       | Event                                               | Status              |
| ---------- | --------------------------------------------------- | ------------------- |
| 14:36:12   | Command executed with `--base-branch feat/perf.t`   | ❌ Option provided  |
| 14:36:31   | Repository cloned and checked out to `main`         | ✅ Normal           |
| 14:36:31   | Branch created from `main` instead of `feat/perf.t` | ❌ Bug occurred     |
| 14:36:42   | PR creation correctly used `feat/perf.t` as target  | ✅ Partially worked |
| Later      | User noticed PR contains wrong commits              | ❌ Issue discovered |
| 2025-11-05 | Issue #681 reported                                 | 📝 Documented       |

## Evidence Summary

### Evidence 1: Command Line

```bash
--base-branch feat/perf.t
```

Source: `first-session-log.txt:10`

### Evidence 2: Branch Creation Log

```
🌿 Creating branch: issue-5-f81abcbe3f46 from main
```

Source: `first-session-log.txt:73`
**Problem**: Should say "from feat/perf.t"

### Evidence 3: PR Target

```
🎯 Target branch: feat/perf.t (custom)
```

Source: `first-session-log.txt:143`
**Note**: PR creation correctly recognized the custom base

### Evidence 4: PR Command

```bash
gh pr create --draft ... --base feat/perf.t --head konard:issue-5-f81abcbe3f46
```

Source: `first-session-log.txt:164`
**Note**: PR command is correct, but branch history is already wrong

## Recommended Reading Order

### For Quick Understanding

1. Start with [README.md](./README.md)
2. Review [INCIDENT-REPORT.md](./INCIDENT-REPORT.md) - Timeline section

### For Technical Deep Dive

1. Read [ROOT-CAUSE-ANALYSIS.md](./ROOT-CAUSE-ANALYSIS.md) - Complete technical details
2. Review [PROPOSED-SOLUTIONS.md](./PROPOSED-SOLUTIONS.md) - Solution 1

### For Implementation

1. Review [PROPOSED-SOLUTIONS.md](./PROPOSED-SOLUTIONS.md) - All solutions
2. Check testing plan and success criteria
3. Review preventive measures

### For Management/Oversight

1. Read [INCIDENT-REPORT.md](./INCIDENT-REPORT.md)
2. Review impact assessment and action items
3. Check lessons learned section

## Action Items Status

### Critical (Fix the Bug)

- [ ] Implement Solution 1 from PROPOSED-SOLUTIONS.md
- [ ] Test with real repositories
- [ ] Release patch version

### Important (Prevent Recurrence)

- [ ] Add automated tests
- [ ] Update documentation
- [ ] Add validation for base branch existence

### Nice to Have (Code Quality)

- [ ] Improve variable naming
- [ ] Add preventive measures
- [ ] Create integration test suite

## Related Issues

- Issue #681: https://github.com/deep-assistant/hive-mind/issues/681
- Affected PR #6: https://github.com/uselessgoddess/bar/pull/6

## Statistics

- **Investigation Time**: ~30 minutes
- **Lines of Code to Fix**: ~5 lines
- **Test Files to Add**: 1
- **Documentation Pages**: 4
- **Log Files Analyzed**: 2 (total 1.1MB, 23,670 lines)

## Tags

`bug` `git-operations` `branch-management` `high-severity` `easy-fix` `incomplete-implementation` `cli-options` `pull-requests`
