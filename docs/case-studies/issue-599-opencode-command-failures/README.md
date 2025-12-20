# Case Study: OpenCode Tool Command Failures

**Issue Reference**: [#599](https://github.com/link-assistant/hive-mind/issues/599)

**Related Pull Request**: https://github.com/veb86/zcadvelecAI/pull/313#issuecomment-3431504835

**Date**: 2025-10-23

**Status**: ✅ Root Cause Identified

---

## Executive Summary

When using `--tool opencode` option in the solve command, the OpenCode AI agent attempts to execute GitHub CLI commands but encounters multiple errors due to incorrect command syntax. The errors do not prevent the OpenCode agent from completing its task, but they indicate underlying issues with how the agent generates GitHub CLI commands.

## Problem Description

The `--tool opencode` option was used to solve GitHub issue #241 in the veb86/zcadvelecAI repository. While the OpenCode agent successfully completed the implementation and marked the PR as ready for review, it encountered several command execution errors during the process.

### Environment

- **Hive Mind Version**: v0.24.41
- **Tool**: OpenCode with grok-code-fast-1 model
- **Operating System**: Linux (likely Ubuntu/Debian)
- **Node Version**: v20.19.5
- **Repository**: veb86/zcadvelecAI
- **Issue**: #241
- **Pull Request**: #313
- **Branch**: issue-241-f5b551ba

### Command Used

```bash
/home/hive/.nvm/versions/node/v20.19.5/bin/node /home/hive/.bun/bin/solve \
  https://github.com/veb86/zcadvelecAI/issues/241 \
  --tool opencode \
  --auto-fork \
  --auto-continue \
  --attach-logs \
  --verbose \
  --no-tool-check
```

## Root Cause Analysis

### Error 1: Incorrect gh pr command - "comments" vs "comment"

**Location**: Line 299 of the log
**Timestamp**: 2025-10-22T10:02:21.742Z

```
[2025-10-22T10:02:21.742Z] [INFO] | Bash     gh pr comments 313 --repo veb86/zcadvelecAI

[2025-10-22T10:02:21.791Z] [INFO] unknown command "comments" for "gh pr"

Did you mean this?
	comment
```

**Root Cause**:
The OpenCode agent executed `gh pr comments` (plural) when the correct command is `gh pr comment` (singular). This is a simple typo in the command generation logic.

**Impact**:
- Low - The agent was able to continue and complete the task despite this error
- The agent was trying to retrieve PR comments for feedback but failed
- The agent recovered and found an alternative approach

### Error 2: Malformed gh pr comment command

**Location**: Lines 565 & 571 of the log
**Timestamp**: 2025-10-22T10:02:56.010Z and 2025-10-22T10:02:58.778Z

```
[2025-10-22T10:02:56.010Z] [INFO] | Bash     gh pr comment list 313 --repo veb86/zcadvelecAI

[2025-10-22T10:02:56.024Z] [INFO]
accepts at most 1 arg(s), received 2
```

**Root Cause**:
The OpenCode agent attempted to use a non-existent subcommand pattern: `gh pr comment list 313`. The correct approach would be:
- To list comments on a PR: Use GitHub API directly with `gh api repos/OWNER/REPO/pulls/NUMBER/comments`
- To add a comment: Use `gh pr comment PR_NUMBER --body "comment text" --repo OWNER/REPO`
- To view PR details including comments: Use `gh pr view PR_NUMBER --comments --repo OWNER/REPO`

The command structure `gh pr comment list` does not exist. The `gh pr comment` command is for creating comments, not listing them.

**Impact**:
- Low - The agent was able to continue and complete the task despite this error
- The agent made two attempts with the same incorrect command before giving up
- This suggests the agent's error recovery mechanism includes retries with the same command

### Why These Errors Don't Break the Workflow

Despite these command failures, the OpenCode agent:
1. Successfully completed the implementation for issue #241
2. Created appropriate commits
3. Marked the PR as ready for review
4. Generated comprehensive documentation

This indicates that:
- The agent has robust error handling
- Failed commands don't cause the entire workflow to crash
- The agent can adapt and find alternative approaches when commands fail
- The core functionality works, but the GitHub CLI integration has issues

## Impact Assessment

### Severity: Medium

While the errors don't prevent task completion, they indicate:
1. **Quality Issues**: The agent generates incorrect commands that pollute logs
2. **Inefficiency**: Failed commands waste time and API calls
3. **User Experience**: Error messages in logs may confuse users
4. **Reliability Concerns**: Shows gaps in command generation logic

### Affected Components

1. **OpenCode Agent Command Generation**: The agent that generates bash commands
2. **GitHub CLI Integration**: How the agent interacts with the gh tool
3. **Error Recovery Logic**: While functional, it retries with incorrect commands

## Reproduction Steps

### Prerequisites

- Node.js v20+ installed
- GitHub CLI (gh) installed and authenticated
- Hive Mind solve tool installed
- Access to a GitHub repository (preferably a fork or test repo)
- OpenCode CLI installed and configured

### Step-by-Step Reproduction

1. **Set up test environment**:
   ```bash
   # Ensure gh is authenticated
   gh auth status

   # Ensure opencode is installed
   opencode --version
   ```

2. **Run solve with opencode tool**:
   ```bash
   solve https://github.com/OWNER/REPO/issues/ISSUE_NUMBER \
     --tool opencode \
     --verbose
   ```

3. **Monitor logs for errors**:
   - Look for "unknown command" errors related to gh CLI
   - Look for "accepts at most X arg(s)" errors
   - Check timestamps to see when errors occur

4. **Verify the issue persists**:
   ```bash
   # Check if opencode attempts these commands:
   gh pr comments 313 --repo OWNER/REPO
   gh pr comment list 313 --repo OWNER/REPO
   ```

### Minimal Test Case

Create a simple test script to verify the issue:

```bash
#!/bin/bash
# Test incorrect gh commands that OpenCode might generate

echo "Testing incorrect gh pr commands..."

# This should fail (comments is plural)
echo "Test 1: gh pr comments"
gh pr comments 123 --repo test/repo 2>&1 || echo "FAILED as expected"

# This should fail (no 'list' subcommand)
echo "Test 2: gh pr comment list"
gh pr comment list 123 --repo test/repo 2>&1 || echo "FAILED as expected"

echo "Testing correct alternatives..."

# Correct way to list comments
echo "Test 3: gh api (correct)"
gh api repos/OWNER/REPO/pulls/123/comments --jq '.[].body' 2>&1

# Correct way to view PR with comments
echo "Test 4: gh pr view (correct)"
gh pr view 123 --repo OWNER/REPO --json comments 2>&1
```

## Potential Solutions

### Solution 1: Fix Command Generation in OpenCode Agent Prompts

**File**: `src/opencode.prompts.lib.mjs` (if it exists)

Update the system prompt or instructions given to OpenCode to include correct GitHub CLI command patterns:

```javascript
// Add to system prompt or guidelines
const githubCliGuidelines = `
When using GitHub CLI commands:
- To list PR comments: gh api repos/OWNER/REPO/pulls/NUMBER/comments
- To add PR comment: gh pr comment NUMBER --body "text" --repo OWNER/REPO
- To view PR: gh pr view NUMBER --repo OWNER/REPO
- NEVER use "gh pr comments" (plural)
- NEVER use "gh pr comment list"
`;
```

### Solution 2: Add Command Validation Layer

Create a validation layer that checks commands before execution:

```javascript
const validateGhCommand = (command) => {
  const invalidPatterns = [
    /gh pr comments\b/,  // Should be 'comment' (singular)
    /gh pr comment list\b/,  // No 'list' subcommand exists
    /gh issue comments\b/,  // Should be 'comment' (singular)
  ];

  for (const pattern of invalidPatterns) {
    if (pattern.test(command)) {
      throw new Error(`Invalid gh command pattern: ${command}`);
    }
  }

  return true;
};
```

### Solution 3: Provide Command Examples in Context

Enhance the OpenCode execution context with working examples:

```javascript
const commandExamples = `
# GitHub CLI Command Examples
# ===========================

# List PR comments (use API):
gh api repos/veb86/zcadvelecAI/pulls/313/comments --jq '.[].body'

# View PR with comments:
gh pr view 313 --repo veb86/zcadvelecAI --json comments

# Add a comment to PR:
gh pr comment 313 --body "My comment" --repo veb86/zcadvelecAI

# List issue comments (use API):
gh api repos/veb86/zcadvelecAI/issues/241/comments --jq '.[].body'
`;
```

### Solution 4: Implement Command Correction Middleware

Create middleware that automatically corrects common mistakes:

```javascript
const correctGhCommand = (command) => {
  // Fix "gh pr comments" -> "gh api ... /comments"
  command = command.replace(
    /gh pr comments (\d+) --repo ([^\s]+)/,
    'gh api repos/$2/pulls/$1/comments'
  );

  // Fix "gh pr comment list" -> "gh api ... /comments"
  command = command.replace(
    /gh pr comment list (\d+) --repo ([^\s]+)/,
    'gh api repos/$2/pulls/$1/comments'
  );

  return command;
};
```

## Workarounds

### For Users

1. **Use --verbose flag**: This helps see what commands are failing
2. **Don't rely on comment feedback**: The agent can still complete tasks without reading comments
3. **Monitor logs**: Check for repeated command failures
4. **Use --no-tool-check**: Skip validation if needed (as in the original command)

### For Developers

1. **Patch the agent prompts**: Add GitHub CLI best practices to prompts
2. **Use command-stream error handling**: Ensure failed commands are caught
3. **Log correct alternatives**: When a command fails, log what should have been used
4. **Add tests**: Create integration tests for common gh CLI patterns

## Recommended Next Steps

### Immediate (High Priority)

1. ✅ **Document the issue** - Create this case study
2. **Update OpenCode prompts** - Add correct gh CLI patterns
3. **Test the fix** - Verify corrected prompts work

### Short-term (Medium Priority)

4. **Add command validation** - Prevent incorrect commands from executing
5. **Improve error messages** - Show correct command when validation fails
6. **Create regression tests** - Prevent this issue from recurring

### Long-term (Low Priority)

7. **Build command library** - Central repository of correct gh CLI commands
8. **Add command linting** - Static analysis for command correctness
9. **Improve agent training** - Use this case as training data

## Related Issues

- Review other OpenCode execution logs for similar patterns
- Check if Claude tool has the same issues
- Investigate command-stream error handling

## References

### GitHub CLI Documentation

- [gh pr comment](https://cli.github.com/manual/gh_pr_comment) - Official documentation
- [gh api](https://cli.github.com/manual/gh_api) - For direct API access
- [Listing PR comments](https://docs.github.com/en/rest/pulls/comments) - REST API reference

### Hive Mind Codebase

- `src/opencode.lib.mjs` - OpenCode execution logic
- `src/opencode.prompts.lib.mjs` - Prompt building (needs to be checked/created)
- `src/solve.mjs` - Main solve command entry point

## Conclusion

The `--tool opencode` command failures are caused by incorrect GitHub CLI command syntax generated by the OpenCode agent. While these errors don't prevent task completion, they indicate a need for:

1. Better command generation guidelines in agent prompts
2. Validation layer for common command patterns
3. Improved error recovery that suggests correct alternatives

The issue is reproducible and has clear solutions that can be implemented incrementally.

---

**Case Study Author**: AI Issue Solver
**Last Updated**: 2025-10-23
