# Issue #625: Git Revert Conflict Analysis and Solutions

## Root Cause

The error occurs when:
1. `solve.mjs` creates an initial commit that **modifies** (not creates) CLAUDE.md by appending task info
2. During the session, CLAUDE.md is modified again (e.g., by prettier formatting, removing trailing newline)
3. CLAUDE.md changes are included in subsequent commits
4. At cleanup time, `git revert ${commitHash}` tries to revert the initial commit
5. Git detects that CLAUDE.md has changed since the initial commit and creates a merge conflict

## Real-World Example from test-anywhere repo

**Initial commit** (2c5f9ae):
- CLAUDE.md already existed (from issue #14 and #16)
- Script **appended** new task info for issue #19
- Changed: "M  CLAUDE.md" (modified, not added)

**During session**:
- prettier formatted CLAUDE.md, changing: `Proceed.\n` → `Proceed.` (removed trailing newline)
- CLAUDE.md was committed again in work commit

**At cleanup**:
- `git revert 2c5f9ae` fails with "CONFLICT (content): Merge conflict in CLAUDE.md"
- Revert expected CLAUDE.md to have trailing newline, but it was removed by prettier

## Solution Approaches

### Approach 1: Three-way merge revert with automatic conflict resolution ✅ RECOMMENDED

**Strategy**: Detect conflicts and auto-resolve by preferring the state before the initial commit.

```javascript
// Attempt revert
const revertResult = await $({ cwd: tempDir })`git revert ${commitToRevert} --no-edit 2>&1`;

if (revertResult.code !== 0 && revertResult.stderr.includes('CONFLICT')) {
  // Conflict detected - check if it's CLAUDE.md
  const statusResult = await $({ cwd: tempDir })`git status --short`;

  if (statusResult.stdout.includes('CLAUDE.md')) {
    // Get the state of CLAUDE.md from before the initial commit
    const parentCommit = `${commitToRevert}~1`;
    const parentFileExists = await $({ cwd: tempDir })`git cat-file -e ${parentCommit}:CLAUDE.md 2>&1`;

    if (parentFileExists.code === 0) {
      // CLAUDE.md existed before - restore it to that state
      await $({ cwd: tempDir })`git checkout ${parentCommit} -- CLAUDE.md`;
    } else {
      // CLAUDE.md didn't exist before - delete it
      await $({ cwd: tempDir })`git rm CLAUDE.md`;
    }

    // Complete the revert
    await $({ cwd: tempDir })`git add CLAUDE.md`;
    await $({ cwd: tempDir })`git revert --continue --no-edit`;
  }
}
```

**Pros**:
- Handles both cases: CLAUDE.md existed before OR was newly created
- Minimal data loss risk - preserves pre-session state
- Aligns with git's three-way merge semantics
- Robust against edge cases

**Cons**:
- Slightly more complex logic
- Requires checking parent commit

### Approach 2: Abort and manual cleanup

**Strategy**: When conflict occurs, abort the revert and manually restore CLAUDE.md.

```javascript
if (revertResult.code !== 0) {
  // Abort the revert
  await $({ cwd: tempDir })`git revert --abort`;

  // Get CLAUDE.md state from parent of initial commit
  const parentCommit = `${commitToRevert}~1`;
  const exists = await $({ cwd: tempDir })`git cat-file -e ${parentCommit}:CLAUDE.md 2>&1`;

  if (exists.code === 0) {
    // Restore to parent state
    await $({ cwd: tempDir })`git show ${parentCommit}:CLAUDE.md > CLAUDE.md`;
  } else {
    // Delete the file
    await $({ cwd: tempDir })`rm -f CLAUDE.md`;
  }

  // Create a manual revert commit
  await $({ cwd: tempDir })`git add CLAUDE.md`;
  await $({ cwd: tempDir })`git commit -m "Revert CLAUDE.md changes from initial commit"`;
}
```

**Pros**:
- Clean separation: abort on conflict, then manual fix
- Easy to understand flow
- No hanging revert state

**Cons**:
- Loses git's automatic revert metadata
- Custom commit message instead of "Revert..." format
- Doesn't preserve git history conventions

### Approach 3: Check for modifications before reverting

**Strategy**: Detect if CLAUDE.md was modified after initial commit, use different cleanup strategy.

```javascript
// Check if CLAUDE.md was modified since the initial commit
const diffResult = await $({ cwd: tempDir })`git diff ${commitToRevert} HEAD -- CLAUDE.md`;

if (diffResult.stdout.trim()) {
  // CLAUDE.md was modified - use manual approach
  const parentCommit = `${commitToRevert}~1`;
  const exists = await $({ cwd: tempDir })`git cat-file -e ${parentCommit}:CLAUDE.md 2>&1`;

  if (exists.code === 0) {
    await $({ cwd: tempDir })`git checkout ${parentCommit} -- CLAUDE.md`;
  } else {
    await $({ cwd: tempDir})`git rm -f CLAUDE.md`;
  }
  await $({ cwd: tempDir })`git commit -m "Revert: Remove CLAUDE.md changes from initial commit"`;
} else {
  // No modifications - safe to revert
  await $({ cwd: tempDir })`git revert ${commitToRevert} --no-edit`;
}
```

**Pros**:
- Proactive detection before attempting revert
- Avoids conflict entirely
- Can optimize for the common case

**Cons**:
- Still needs manual commit for modified case
- More upfront checks
- Doesn't use git revert in all cases

### Approach 4: Always use manual CLAUDE.md removal (simplest)

**Strategy**: Don't use `git revert` at all. Always manually restore CLAUDE.md to pre-session state.

```javascript
// Get the state before initial commit
const parentCommit = `${claudeCommitHash}~1`;
const existedBefore = await $({ cwd: tempDir })`git cat-file -e ${parentCommit}:CLAUDE.md 2>&1`;

if (existedBefore.code === 0) {
  // Restore to previous state
  await $({ cwd: tempDir })`git checkout ${parentCommit} -- CLAUDE.md`;
  await $({ cwd: tempDir })`git commit -m "Revert \\"Initial commit with task details for issue #XXX\\""`;
} else {
  // File didn't exist - remove it
  await $({ cwd: tempDir })`git rm CLAUDE.md`;
  await $({ cwd: tempDir })`git commit -m "Revert \\"Initial commit with task details for issue #XXX\\""`;
}
```

**Pros**:
- Simplest implementation
- Always works, no conflict possible
- Easy to reason about

**Cons**:
- Loses `git revert` metadata and conventions
- If initial commit had other files, they won't be reverted
- Not a true revert, just manual cleanup

## Recommendation

**Approach 1** (Three-way merge with automatic conflict resolution) is the best solution because:

1. **Handles all cases**: Works whether CLAUDE.md existed before or not
2. **Preserves git semantics**: Uses `git revert` when possible, gracefully handles conflicts
3. **Minimal data loss**: Restores exact pre-session state
4. **Robust**: Handles edge cases like prettier formatting, manual edits, etc.
5. **Maintains git history**: Keeps proper revert commits with metadata

The implementation should:
- Try `git revert` first
- Detect CLAUDE.md conflicts
- Auto-resolve by checking parent commit state
- Complete the revert with resolved conflicts
- Fall back to current behavior only if something unexpected happens

## Test Cases to Cover

1. **CLAUDE.md created fresh** (file didn't exist before)
   - Initial commit adds CLAUDE.md
   - No modifications during session
   - Revert should delete the file

2. **CLAUDE.md existed and appended to** (test-anywhere case)
   - Initial commit modifies existing CLAUDE.md
   - Prettier or other tool modifies it again
   - Revert should restore to pre-session state

3. **CLAUDE.md existed, appended, then deleted**
   - Initial commit modifies CLAUDE.md
   - Later commit removes CLAUDE.md
   - Revert should restore to pre-session state

4. **Multiple tasks in sequence** (hive-mind case)
   - Task 1: creates CLAUDE.md
   - Task 1: reverts CLAUDE.md
   - Task 2: creates CLAUDE.md again
   - Task 2: should revert successfully
