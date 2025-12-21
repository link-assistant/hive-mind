# Solutions Implementation Guide

This document provides detailed implementation instructions for fixing the OpenCode gh CLI command errors.

## Overview

The OpenCode agent generates incorrect GitHub CLI commands. This guide presents four solution approaches, ranked by implementation complexity and effectiveness.

---

## Solution 1: Update OpenCode System Prompts ⭐ RECOMMENDED

**Priority**: High
**Complexity**: Low
**Effectiveness**: High
**Files to modify**: `src/opencode.prompts.lib.mjs`

### Implementation

Check if the prompts library exists and update it:

```bash
# Check if file exists
ls -la src/opencode.prompts.lib.mjs
```

If it doesn't exist, create it. Otherwise, update the `buildSystemPrompt` function:

```javascript
// In src/opencode.prompts.lib.mjs

export const buildSystemPrompt = ({
  owner,
  repo,
  issueNumber,
  prNumber,
  branchName,
  tempDir,
  isContinueMode,
  forkedRepo,
  argv
}) => {
  // ... existing prompt content ...

  const githubCliGuidelines = `

GitHub CLI Command Guidelines:
================================

IMPORTANT: Use these exact command patterns when working with GitHub CLI (gh).

Listing Comments:
  ✓ CORRECT: gh api repos/OWNER/REPO/pulls/PR_NUMBER/comments
  ✓ CORRECT: gh api repos/OWNER/REPO/issues/ISSUE_NUMBER/comments
  ✗ WRONG: gh pr comments PR_NUMBER --repo OWNER/REPO (command doesn't exist)
  ✗ WRONG: gh pr comment list PR_NUMBER --repo OWNER/REPO (no 'list' subcommand)

Viewing Pull Requests:
  ✓ CORRECT: gh pr view PR_NUMBER --repo OWNER/REPO
  ✓ CORRECT: gh pr view PR_NUMBER --repo OWNER/REPO --json comments,reviews
  ✗ WRONG: gh pr comments PR_NUMBER --repo OWNER/REPO

Adding Comments:
  ✓ CORRECT: gh pr comment PR_NUMBER --body "comment text" --repo OWNER/REPO
  ✓ CORRECT: gh issue comment ISSUE_NUMBER --body "comment text" --repo OWNER/REPO
  ✗ WRONG: gh pr comments PR_NUMBER --body "text" --repo OWNER/REPO

Common Patterns:
  - Always use "comment" (singular), never "comments" (plural) with gh pr/issue
  - Use gh api for listing comments, not gh pr comment list
  - Use --jq for filtering JSON responses from gh api

Examples:
  # Get latest 5 PR comments
  gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --jq 'reverse | .[0:5]'

  # Check if there are new comments
  gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --jq 'length'

  # Get comment authors
  gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --jq '.[].user.login'
`;

  return systemPrompt + githubCliGuidelines;
};
```

### Testing

1. Create a test issue in a test repository
2. Run solve with OpenCode:
   ```bash
   solve https://github.com/test-owner/test-repo/issues/1 \
     --tool opencode \
     --verbose \
     2>&1 | tee test-opencode.log
   ```
3. Check the log for:
   - No "unknown command" errors
   - No "accepts at most" errors
   - Correct gh api commands being used

### Verification

```bash
# Check for errors in log
grep "unknown command" test-opencode.log
grep "accepts at most" test-opencode.log

# Should return nothing if fixed
```

---

## Solution 2: Add Command Validation Layer

**Priority**: Medium
**Complexity**: Medium
**Effectiveness**: High
**Files to modify**: `src/opencode.lib.mjs`

### Implementation

Add validation before command execution in `executeOpenCodeCommand`:

```javascript
// In src/opencode.lib.mjs

// Add this function before executeOpenCodeCommand
const validateGhCommand = command => {
  const invalidPatterns = [
    {
      pattern: /gh\s+(pr|issue)\s+comments\b/,
      error: 'Invalid command: use "comment" (singular) not "comments"',
      suggestion: 'Use: gh api repos/OWNER/REPO/pulls/NUMBER/comments'
    },
    {
      pattern: /gh\s+(pr|issue)\s+comment\s+list\b/,
      error: 'Invalid command: "gh pr comment list" does not exist',
      suggestion: 'Use: gh api repos/OWNER/REPO/pulls/NUMBER/comments'
    },
    {
      pattern: /gh\s+pr\s+comments\s+(\d+)\s+--repo\s+([^\s]+)/,
      error: 'Invalid command: "gh pr comments" should be "gh api"',
      suggestion: match => {
        const prNum = match[1];
        const repo = match[2];
        return `Use: gh api repos/${repo}/pulls/${prNum}/comments`;
      }
    }
  ];

  for (const { pattern, error, suggestion } of invalidPatterns) {
    const match = command.match(pattern);
    if (match) {
      const suggestionText = typeof suggestion === 'function' ? suggestion(match) : suggestion;

      return {
        valid: false,
        error,
        suggestion: suggestionText
      };
    }
  }

  return { valid: true };
};

// Update executeOpenCodeCommand to use validation
export const executeOpenCodeCommand = async params => {
  // ... existing code ...

  const executeWithRetry = async () => {
    // ... existing setup code ...

    // Before building the command, validate it
    const validation = validateGhCommand(fullCommand);
    if (!validation.valid) {
      await log(`⚠️  Command validation failed: ${validation.error}`, { level: 'warning' });
      await log(`   💡 Suggestion: ${validation.suggestion}`, { level: 'warning' });
      // Optionally: correct the command automatically
      // fullCommand = validation.suggestion;
    }

    // ... rest of execution code ...
  };
};
```

### Testing

Same as Solution 1, but validation should catch errors before execution.

---

## Solution 3: Command Correction Middleware

**Priority**: Medium
**Complexity**: Medium
**Effectiveness**: Medium
**Files to modify**: `src/opencode.lib.mjs` or create new `src/command-correction.lib.mjs`

### Implementation

Create automatic command correction:

```javascript
// In src/command-correction.lib.mjs (new file)

export const correctGhCommand = command => {
  let corrected = command;
  let wasCorrected = false;
  const corrections = [];

  // Fix 1: gh pr comments -> gh api repos/.../pulls/.../comments
  const prCommentsMatch = command.match(/gh\s+pr\s+comments\s+(\d+)\s+--repo\s+([^\s]+)/);
  if (prCommentsMatch) {
    const prNum = prCommentsMatch[1];
    const repo = prCommentsMatch[2];
    corrected = `gh api repos/${repo}/pulls/${prNum}/comments`;
    wasCorrected = true;
    corrections.push({
      original: `gh pr comments ${prNum} --repo ${repo}`,
      fixed: corrected,
      reason: 'Command "gh pr comments" does not exist'
    });
  }

  // Fix 2: gh pr comment list -> gh api repos/.../pulls/.../comments
  const prCommentListMatch = command.match(/gh\s+pr\s+comment\s+list\s+(\d+)\s+--repo\s+([^\s]+)/);
  if (prCommentListMatch) {
    const prNum = prCommentListMatch[1];
    const repo = prCommentListMatch[2];
    corrected = `gh api repos/${repo}/pulls/${prNum}/comments`;
    wasCorrected = true;
    corrections.push({
      original: `gh pr comment list ${prNum} --repo ${repo}`,
      fixed: corrected,
      reason: 'Subcommand "list" does not exist for "gh pr comment"'
    });
  }

  // Fix 3: gh issue comments -> gh api repos/.../issues/.../comments
  const issueCommentsMatch = command.match(/gh\s+issue\s+comments\s+(\d+)\s+--repo\s+([^\s]+)/);
  if (issueCommentsMatch) {
    const issueNum = issueCommentsMatch[1];
    const repo = issueCommentsMatch[2];
    corrected = `gh api repos/${repo}/issues/${issueNum}/comments`;
    wasCorrected = true;
    corrections.push({
      original: `gh issue comments ${issueNum} --repo ${repo}`,
      fixed: corrected,
      reason: 'Command "gh issue comments" does not exist'
    });
  }

  return {
    command: corrected,
    wasCorrected,
    corrections
  };
};

// Export for use in opencode.lib.mjs
export default { correctGhCommand };
```

Then use it in `opencode.lib.mjs`:

```javascript
// In src/opencode.lib.mjs
import { correctGhCommand } from './command-correction.lib.mjs';

export const executeOpenCodeCommand = async params => {
  // ... in the command building section ...

  // Before execution, try to correct the command
  const { command: correctedCommand, wasCorrected, corrections } = correctGhCommand(fullCommand);

  if (wasCorrected) {
    await log('🔧 Auto-corrected command:', { level: 'info' });
    for (const correction of corrections) {
      await log(`   Original: ${correction.original}`, { level: 'info' });
      await log(`   Fixed: ${correction.fixed}`, { level: 'info' });
      await log(`   Reason: ${correction.reason}`, { level: 'info' });
    }
    fullCommand = correctedCommand;
  }

  // ... continue with execution ...
};
```

### Testing

Run with verbose mode and check that:

1. Incorrect commands are detected
2. Corrections are logged
3. Corrected commands execute successfully

---

## Solution 4: Enhanced Error Recovery with Learning

**Priority**: Low
**Complexity**: High
**Effectiveness**: Medium
**Files to modify**: `src/opencode.lib.mjs`, create `src/command-learning.lib.mjs`

### Implementation

Create a learning system that remembers failed commands:

```javascript
// In src/command-learning.lib.mjs (new file)

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const LEARNING_FILE = path.join(os.homedir(), '.hive-mind-command-corrections.json');

export class CommandLearning {
  constructor() {
    this.corrections = new Map();
  }

  async load() {
    try {
      const data = await fs.readFile(LEARNING_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      this.corrections = new Map(Object.entries(parsed));
    } catch (error) {
      // File doesn't exist or is invalid, start fresh
      this.corrections = new Map();
    }
  }

  async save() {
    const obj = Object.fromEntries(this.corrections);
    await fs.writeFile(LEARNING_FILE, JSON.stringify(obj, null, 2), 'utf-8');
  }

  recordFailure(command, error, correction = null) {
    const key = this.normalizeCommand(command);
    const existing = this.corrections.get(key) || {
      command,
      failures: 0,
      lastError: null,
      suggestedCorrection: null,
      lastFailure: null
    };

    existing.failures += 1;
    existing.lastError = error;
    existing.lastFailure = new Date().toISOString();

    if (correction) {
      existing.suggestedCorrection = correction;
    }

    this.corrections.set(key, existing);
    return this.save();
  }

  getSuggestion(command) {
    const key = this.normalizeCommand(command);
    const record = this.corrections.get(key);
    return record?.suggestedCorrection || null;
  }

  normalizeCommand(command) {
    // Normalize command for matching (remove specific numbers, repos)
    return command
      .replace(/\d+/g, 'NUMBER')
      .replace(/[a-z0-9-]+\/[a-z0-9-]+/gi, 'OWNER/REPO')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

export default CommandLearning;
```

### Testing

Requires multiple runs to build up learning data.

---

## Implementation Priority

### Phase 1 (Immediate) - Week 1

- ✅ Solution 1: Update prompts with correct command examples
- Test with 3-5 different issues

### Phase 2 (Short-term) - Week 2-3

- Solution 2: Add validation layer
- Create integration tests for command validation

### Phase 3 (Medium-term) - Month 2

- Solution 3: Implement command correction
- Add telemetry for tracking correction success rate

### Phase 4 (Long-term) - Month 3+

- Solution 4: Build learning system
- Analyze patterns across many solve sessions

---

## Testing Checklist

For each solution:

- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] No regression in existing functionality
- [ ] Correct commands are generated
- [ ] Error logs are clean
- [ ] Performance impact is minimal
- [ ] Documentation is updated
- [ ] Code review completed

---

## Rollback Plan

If any solution causes issues:

1. **Git revert**: Each solution should be in its own commit

   ```bash
   git revert <commit-hash>
   ```

2. **Feature flag**: Add environment variable to enable/disable

   ```javascript
   if (process.env.HIVE_MIND_COMMAND_CORRECTION === 'true') {
     // Apply corrections
   }
   ```

3. **Gradual rollout**: Test with --dry-run first
   ```bash
   solve URL --tool opencode --dry-run
   ```

---

## Monitoring and Metrics

After implementation, track:

- **Error rate**: Count of gh command failures
- **Correction rate**: How many commands needed correction
- **Success rate**: Percentage of corrected commands that work
- **Performance**: Time overhead of validation/correction

### Monitoring Script

```bash
#!/bin/bash
# Monitor solve logs for command correction metrics

LOG_DIR="${LOG_DIR:-.}"

echo "Command Correction Metrics"
echo "=========================="
echo ""

# Find all solve logs
LOGS=$(find "$LOG_DIR" -name "solve-*.log" -type f)

# Count total gh commands
TOTAL_GH=$(grep -h "gh pr\|gh issue\|gh api" $LOGS | wc -l)

# Count errors
ERRORS=$(grep -h "unknown command\|accepts at most" $LOGS | wc -l)

# Count corrections (if solution 3 is implemented)
CORRECTIONS=$(grep -h "Auto-corrected command" $LOGS | wc -l)

echo "Total gh commands: $TOTAL_GH"
echo "Errors encountered: $ERRORS"
echo "Corrections applied: $CORRECTIONS"
echo ""

if [ $TOTAL_GH -gt 0 ]; then
  ERROR_RATE=$(echo "scale=2; $ERRORS / $TOTAL_GH * 100" | bc)
  echo "Error rate: ${ERROR_RATE}%"
fi
```

---

## Additional Resources

- [GitHub CLI Manual](https://cli.github.com/manual/)
- [GitHub REST API - Pull Requests](https://docs.github.com/en/rest/pulls)
- [OpenCode Documentation](https://opencode.ai/docs)
- [Hive Mind Contributing Guide](../../CONTRIBUTING.md)

---

## Questions and Support

If you encounter issues while implementing these solutions:

1. Check the [main README](./README.md) for context
2. Review the [error summary](./error-summary.md) for specific error patterns
3. Run the [reproduction script](./reproduce-errors.sh) to verify the issue
4. Open an issue at https://github.com/link-assistant/hive-mind/issues

---

**Last Updated**: 2025-10-23
**Maintained by**: Hive Mind Development Team
