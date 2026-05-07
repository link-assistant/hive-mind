# Case Study: Workflow Approval Issue in PR #588 (reagento/dishka)

## Executive Summary

This case study documents the analysis of [PR #588](https://github.com/reagento/dishka/pull/588) which encountered GitHub Actions workflow approval requirements that prevented automated CI/CD testing. The AI solve command was unable to start all checks equivalent to those in GitHub Actions workflows, and failed to adhere to the contributing guidelines by default.

## Problem Statement

The main issue was that the AI solve command (using Claude Code) encountered:

1. **Workflow Approval Barriers**: GitHub Actions workflows required manual approval from maintainers before running
2. **Missing Contributing Guidelines**: The AI did not have access to https://dishka.readthedocs.io/en/stable/contributing.html during the solve process
3. **Incomplete Test Coverage**: Not all CI checks were run locally before pushing

## Timeline of Events

### Initial Commit (2025-10-09 07:48:03Z)

- **Commit**: `5ec21e248a109ba320b7e7c6ac812a1d70b8990d`
- **Action**: Created initial CLAUDE.md with task information
- **Result**: Workflow run `18369320865` - **action_required** (never ran)

### First Implementation (2025-10-09 07:52:18Z)

- **Commit**: `90d5eb86cc3dd96c4922212d1af0f77cbdc5104c`
- **Action**: Initial fix attempt for KeyError issue
- **Result**: Workflow run `18369424758` - **action_required** (never ran)

### Cleanup (2025-10-09 07:56:26Z)

- **Commit**: `55a7c0937e4eb3abe47eb6630f83ec9eb1c0a836`
- **Action**: Removed experiment and config files
- **Result**: Workflow run `18369494097` - **failure** (finally ran after approval, but had lint errors)

### First Fix Attempt (2025-10-09 08:09:40Z)

- **Commit**: `7c1faa3a3f0e3554cde0ee25390f1404eab8958c`
- **Action**: Fixed line length violations (E501)
- **Result**: Workflow run `18369814716` - **failure** (still had lint errors)

### Root Cause Fix (2025-10-09 08:36:50Z)

- **Commit**: `f45a1756102cffd250097698a891f839bf0bccce`
- **Action**: Addressed root cause with WebSocket parameter detection
- **Result**: Workflow run `18370513207` - **failure** (E501 and PLR5501 errors)

### Lint Fix 1 (2025-10-09 08:48:27Z)

- **Commit**: `07b92e8197b3b0641f8ded1084e263325ebaa6b9`
- **Action**: Fixed docstring line length
- **Result**: Workflow run `18370799499` - **action_required** (approval needed again)

### Final Fix (2025-10-09 09:06:34Z)

- **Commit**: `c897cafff24692c704d35378f73df38349cd4fb5`
- **Action**: Fixed elif code style issue
- **Result**: Workflow run `18371262626` - **success** (all checks passed)

## Root Cause Analysis

### 1. Workflow Approval Requirement

**Issue**: GitHub Actions has a security feature that requires approval from maintainers for workflows triggered by first-time contributors or contributors from forks.

**Evidence**:

- Multiple workflow runs show `"conclusion": "action_required"` status
- These runs never executed until a maintainer approved them
- Screenshot shows "1 workflow awaiting approval" warning

**Impact**:

- AI couldn't see test results immediately after push
- Multiple commits were made without feedback from CI
- Wasted time on iterations that could have been caught locally

### 2. Missing Contributing Guidelines

**Issue**: The AI solver didn't have access to the contributing guidelines during execution.

**Required Checks** (from https://dishka.readthedocs.io/en/stable/contributing.html):

- `ruff check` - Linting with 79 character line limit
- `mypy` - Type checking
- `nox` - Running tests
- Specific code style requirements

**Evidence**:

- Multiple lint errors (E501, PLR5501) that should have been caught before commit
- No evidence of running `ruff check` locally before pushing
- 7 commits total, 4 of which were just fixing lint errors

### 3. Incomplete Local Testing

**Issue**: The solve command didn't run the same checks locally that would run in CI.

**Missing Steps**:

1. No local `ruff check .` before commits
2. No local test execution
3. No validation against contributing guidelines

## Key Events Leading to the Problem

### Event 1: First Workflow Approval Needed (07:48:26Z)

```
Workflow: CI (18369320865)
Status: action_required
Conclusion: action_required
```

**Impact**: AI pushed code without knowing if it would pass CI

### Event 2: Lint Errors Discovered (07:56:32Z - 08:01:04Z)

```
Testing (3.10) Run ruff
E501 Line too long (87 > 79)
  --> src/dishka/integrations/fastapi.py:125:80
```

**Impact**: First real feedback from CI, but only after manual approval

### Event 3: Multiple Lint Fix Iterations (08:09:47Z - 09:06:34Z)

- Commit: Fix E501 error
- Commit: Fix docstring line length
- Commit: Fix PLR5501 code style

**Impact**: 3 commits just to fix lint errors that could have been caught with one local `ruff check .`

### Event 4: Second Approval Needed (08:48:34Z)

```
Workflow: CI (18370799499)
Status: action_required
```

**Impact**: Even after multiple commits, still needed approval

### Event 5: Final Success (09:06:46Z - 09:14:08Z)

```
Workflow: CI (18371262626)
Status: completed
Conclusion: success
```

**Impact**: After 7 commits and ~1.5 hours, finally passed all checks

## Downloaded Artifacts

The following files have been preserved in this case study folder:

1. **pr588_details.json** - Full PR metadata including all commits
2. **pr588_checks.json** - All CI check results
3. **pr588_runs.json** - Workflow run history
4. **run_18370513207_failure.log** - Detailed logs from a failed run
5. **run_18371262626_success.log** - Logs from the successful run
6. **contributing_guidelines.html** - The contributing guidelines that should have been referenced
7. **screenshot.png** - Screenshot showing the workflow approval warning

## Proposed Solutions

### Solution 1: Fetch Contributing Guidelines Proactively

**Implementation**: Add logic to detect and fetch CONTRIBUTING.md or contributing guidelines URL before starting work.

**Benefits**:

- AI would know about `ruff check .` requirement
- AI would know about 79 character line limit
- AI would know about code style requirements

### Solution 2: Run Local CI Checks Before Pushing

**Implementation**: Detect common CI tools and run them locally:

- If `ruff.toml` or `pyproject.toml` with ruff config exists: run `ruff check .`
- If `mypy.ini` or mypy config exists: run `mypy .`
- If `noxfile.py` exists: run `nox` (or specific sessions)
- If `.github/workflows/*.yml` exists: analyze and attempt to run checks locally

**Benefits**:

- Catch lint/style errors before pushing
- Reduce commit spam
- Faster feedback loop

### Solution 3: Detect and Warn About Workflow Approvals

**Implementation**: After pushing, check workflow status and detect "action_required" state.

**Behavior**:

- If workflows are pending approval: warn user and suggest local testing
- Provide instructions to run checks locally while waiting
- Optionally pause and wait for approval before continuing

**Benefits**:

- User awareness of approval requirements
- Opportunity to run local checks during wait time
- Better use of time while waiting for approval

### Solution 4: Enhanced CLAUDE.md with Contributing Guidelines

**Implementation**: When creating CLAUDE.md, include a section with contributing guidelines URL.

**Example**:

```markdown
Issue to solve: https://github.com/reagento/dishka/issues/575
Your prepared branch: issue-575-1134b6a2
Your prepared working directory: /tmp/...

Contributing Guidelines: https://dishka.readthedocs.io/en/stable/contributing.html

Key Requirements:

- Run `ruff check .` before committing
- Run `mypy` for type checking
- Run tests with `nox`
- Follow 79 character line limit

Proceed.
```

**Benefits**:

- Guidelines are immediately visible to AI
- AI can reference them throughout the session
- Reduces errors and iterations

## Metrics

- **Total Commits**: 7
- **Commits for Lint Fixes**: 4 (57%)
- **Time to Success**: ~1.5 hours (07:48:03Z to 09:14:08Z)
- **Workflow Runs**: 8
- **Action Required Runs**: 3 (37.5%)
- **Failed Runs**: 3 (37.5%)
- **Successful Runs**: 2 (25%)

## Recommendations

### Immediate Actions

1. ✅ Create this case study documentation
2. ✅ Preserve all logs and artifacts
3. ⏳ Implement contributing guidelines fetching
4. ⏳ Add local CI check execution
5. ⏳ Add workflow approval detection

### Long-term Improvements

1. Build a library of common CI patterns (ruff, mypy, pytest, nox, etc.)
2. Create a CI detection and execution framework
3. Add retry logic with local checks while waiting for approvals
4. Improve prompt to emphasize running tests before pushing

## Conclusion

The root cause of the workflow approval issue in PR #588 was a combination of:

1. **GitHub's security feature** requiring manual approval for first-time/fork contributors
2. **Missing contributing guidelines** in the AI's context
3. **No local CI execution** before pushing changes

This resulted in 7 commits over 1.5 hours, with 57% of commits being just lint fixes that could have been caught with a single local `ruff check .` command.

The solution requires a multi-faceted approach:

- Proactively fetch and present contributing guidelines
- Detect and run local CI checks before pushing
- Detect workflow approval requirements and adjust behavior accordingly

By implementing these improvements, future PR iterations can be reduced from 7 commits to potentially 2-3 commits, saving time and reducing noise in the git history.
