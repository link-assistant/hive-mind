# Error Summary - OpenCode Command Failures

## Quick Reference

### Error 1: Unknown Command "comments"

**Command**: `gh pr comments 313 --repo veb86/zcadvelecAI`

**Error**: `unknown command "comments" for "gh pr"`

**Correct Command**:

```bash
# To list comments via API:
gh api repos/veb86/zcadvelecAI/pulls/313/comments

# To view PR with comments:
gh pr view 313 --repo veb86/zcadvelecAI --json comments
```

**Fix**: Change "comments" (plural) to "comment" (singular), or use gh api instead

---

### Error 2: Too Many Arguments

**Command**: `gh pr comment list 313 --repo veb86/zcadvelecAI`

**Error**: `accepts at most 1 arg(s), received 2`

**Correct Command**:

```bash
# To list comments via API:
gh api repos/veb86/zcadvelecAI/pulls/313/comments

# To list comments with specific fields:
gh api repos/veb86/zcadvelecAI/pulls/313/comments --jq '.[] | {author: .user.login, body: .body}'
```

**Fix**: Remove the "list" subcommand as it doesn't exist for `gh pr comment`

---

## Timeline of Errors

| Timestamp     | Error                                | Retry | Outcome                            |
| ------------- | ------------------------------------ | ----- | ---------------------------------- |
| 10:02:21.742Z | `gh pr comments` - unknown command   | No    | Agent continued                    |
| 10:02:56.010Z | `gh pr comment list` - too many args | Yes   | Retry at 10:02:58.778Z             |
| 10:02:58.778Z | `gh pr comment list` - too many args | No    | Agent gave up, continued with task |

---

## Error Pattern Analysis

### Common Mistake Pattern

The OpenCode agent appears to be:

1. **Pluralizing incorrectly**: Using "comments" instead of "comment"
2. **Inventing subcommands**: Using "list" with `gh pr comment` when it doesn't exist
3. **Not learning from errors**: Retrying the same incorrect command

### Why the Agent Continues Despite Errors

The OpenCode agent's resilience comes from:

1. **Non-critical operations**: Comment retrieval is optional, not required
2. **Error handling**: Failed bash commands return exit codes but don't crash the agent
3. **Alternative paths**: The agent can complete tasks without reading all comments
4. **Task completion focus**: The agent prioritizes completing the main task over auxiliary operations

---

## GitHub CLI Command Cheat Sheet

### Correct Patterns for OpenCode

```bash
# Pull Requests
gh pr view PR_NUMBER --repo OWNER/REPO              # View PR details
gh pr list --repo OWNER/REPO                        # List PRs
gh pr comment PR_NUMBER --body "text" --repo OWNER/REPO  # Add comment
gh pr ready PR_NUMBER --repo OWNER/REPO             # Mark PR as ready

# Issues
gh issue view ISSUE_NUMBER --repo OWNER/REPO        # View issue details
gh issue list --repo OWNER/REPO                     # List issues
gh issue comment ISSUE_NUMBER --body "text" --repo OWNER/REPO  # Add comment

# API Access (for listing comments)
gh api repos/OWNER/REPO/pulls/PR_NUMBER/comments    # List PR comments
gh api repos/OWNER/REPO/issues/ISSUE_NUMBER/comments  # List issue comments

# With JQ filtering
gh api repos/OWNER/REPO/pulls/PR_NUMBER/comments --jq '.[].body'
gh api repos/OWNER/REPO/issues/ISSUE_NUMBER/comments --jq 'reverse | .[0:5]'
```

### Incorrect Patterns to Avoid

```bash
# ❌ WRONG - "comments" is plural
gh pr comments 313 --repo OWNER/REPO
gh issue comments 241 --repo OWNER/REPO

# ❌ WRONG - "list" subcommand doesn't exist
gh pr comment list 313 --repo OWNER/REPO
gh issue comment list 241 --repo OWNER/REPO

# ❌ WRONG - these commands don't exist
gh pr comment view 313 --repo OWNER/REPO
gh pr comments list --repo OWNER/REPO
```

---

## Frequency and Impact

### Frequency

- **Observed**: 3 times in a single solve session
- **Expected**: Likely to occur in every OpenCode session that needs to read comments
- **Predictability**: High - same errors occur in predictable situations

### Impact on Different Scenarios

| Scenario         | Impact | Reason                                           |
| ---------------- | ------ | ------------------------------------------------ |
| Simple bug fixes | Low    | Comment reading is optional                      |
| Continue mode    | Medium | Agent may miss user feedback in comments         |
| Complex features | Medium | Missing context from comments may affect quality |
| PR reviews       | High   | Agent needs to read review comments to respond   |

---

## Detection and Monitoring

### How to Detect These Errors

1. **Log analysis**: Search logs for "unknown command" and "accepts at most"
2. **Command pattern matching**: Look for `gh pr comments` or `gh pr comment list`
3. **Exit code monitoring**: Check for non-zero exit codes from gh commands
4. **Verbose mode**: Use `--verbose` flag to see all command attempts

### Monitoring Script

```bash
#!/bin/bash
# Monitor solve logs for OpenCode gh CLI errors

LOG_FILE="$1"

if [ -z "$LOG_FILE" ]; then
  echo "Usage: $0 <log-file>"
  exit 1
fi

echo "Checking for gh CLI errors in $LOG_FILE..."
echo ""

echo "Error 1: Unknown 'comments' command:"
grep -n "gh pr comments\|gh issue comments" "$LOG_FILE" || echo "  Not found"
echo ""

echo "Error 2: 'comment list' pattern:"
grep -n "gh pr comment list\|gh issue comment list" "$LOG_FILE" || echo "  Not found"
echo ""

echo "Error 3: 'accepts at most' errors:"
grep -n "accepts at most.*arg" "$LOG_FILE" || echo "  Not found"
echo ""

echo "Summary:"
ERROR_COUNT=$(grep -c "unknown command\|accepts at most" "$LOG_FILE" || echo "0")
echo "  Total command errors: $ERROR_COUNT"
```

---

## References

- **Main Case Study**: See [README.md](./README.md) for full analysis
- **Original Logs**: See [original-logs.md](./original-logs.md) for complete log file
- **Issue**: https://github.com/link-assistant/hive-mind/issues/599
- **Related PR**: https://github.com/veb86/zcadvelecAI/pull/313#issuecomment-3431504835
