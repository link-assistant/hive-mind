# Issue #724 - Third Fix: Fork Fallback Bug

## Date
2025-11-15

## Problem Statement

After PR #735 was merged with fixes for the `--prefix-fork-name-with-owner-name` option, the feature still didn't work correctly. Users reported that even with the option enabled, the tool was still using the unprefixed fork (`konard/-`) instead of creating or using a prefixed fork (`konard/emirmensitov-afk--`).

## Log Analysis

### Latest Log (2025-11-15T08:40:25.991Z)

Command executed:
```bash
solve https://github.com/emirmensitov-afk/-/issues/1 --prefix-fork-name-with-owner-name --auto-fork --auto-continue --attach-logs --verbose --no-tool-check
```

**Critical Lines:**
- Line 51: `✅ Fork exists: konard/-`
- Line 53: `📥 Cloning repository: konard/-`

Even with `--prefix-fork-name-with-owner-name` enabled, the code detected and used the unprefixed fork.

**Error Lines:**
- Lines 114-127: Compare API returned HTTP 404 errors repeatedly (5 attempts)
- Line 142: `gh pr create --draft --repo emirmensitov-afk/- --base master --head konard:issue-1-5358767cb52c`

The Compare API was being called correctly with the fork reference (`konard:issue-1-5358767cb52c`), but GitHub couldn't find the branch because it was looking in the wrong repository context.

## Root Cause

### The Fallback Logic Bug

In `src/solve.repository.lib.mjs` lines 276-289, the fork detection logic had a fallback mechanism:

```javascript
const expectedForkName = argv.prefixForkNameWithOwnerName ? prefixedForkName : standardForkName;
const alternateForkName = argv.prefixForkNameWithOwnerName ? standardForkName : prefixedForkName;

let forkCheckResult = await $`gh repo view ${expectedForkName} --json name 2>/dev/null`;
if (forkCheckResult.code === 0) {
  existingForkName = expectedForkName;
} else {
  // Try alternate name
  forkCheckResult = await $`gh repo view ${alternateForkName} --json name 2>/dev/null`;
  if (forkCheckResult.code === 0) {
    existingForkName = alternateForkName;  // ← BUG: Uses wrong fork!
  }
}
```

**The Problem:**
1. When `--prefix-fork-name-with-owner-name` is enabled:
   - `expectedForkName` = `konard/emirmensitov-afk--` (prefixed)
   - `alternateForkName` = `konard/-` (standard)
2. Code checks if prefixed fork exists (line 280-282) → Not found
3. Code falls back to check standard fork (line 285-287) → **Found!**
4. Code uses the standard fork even though user requested prefixed fork

This defeats the entire purpose of the `--prefix-fork-name-with-owner-name` option!

### Why This Causes 404 Errors

When the code uses the wrong fork:
1. Branch gets pushed to `konard/-`
2. Compare API is called with `repos/emirmensitov-afk/-/compare/master...konard:issue-1-5358767cb52c`
3. GitHub looks for the branch but can't properly resolve it because the fork name doesn't match what was expected
4. Result: HTTP 404 errors

## The Fix

### Primary Fix: Remove Fallback When Option Is Enabled

Modified `src/solve.repository.lib.mjs` lines 283-292:

```javascript
let forkCheckResult = await $`gh repo view ${expectedForkName} --json name 2>/dev/null`;
if (forkCheckResult.code === 0) {
  existingForkName = expectedForkName;
} else if (!argv.prefixForkNameWithOwnerName) {
  // Only check alternate name if NOT using --prefix-fork-name-with-owner-name
  // When the option is enabled, we ONLY want to use/create the prefixed fork
  // This prevents falling back to an existing standard fork which would cause
  // Compare API 404 errors since branches are in different fork repositories
  forkCheckResult = await $`gh repo view ${alternateForkName} --json name 2>/dev/null`;
  if (forkCheckResult.code === 0) {
    existingForkName = alternateForkName;
  }
} else {
  // Check if alternate (standard) fork exists when prefix option is enabled
  // If it does, warn user since we won't be using it
  const standardForkCheck = await $`gh repo view ${alternateForkName} --json name 2>/dev/null`;
  if (standardForkCheck.code === 0) {
    await log(`${formatAligned('ℹ️', 'Note:', `Standard fork ${alternateForkName} exists but won't be used`)}`);
    await log(`   Creating prefixed fork ${expectedForkName} instead (--prefix-fork-name-with-owner-name enabled)`);
  }
}
```

**Key Changes:**
1. Added condition `!argv.prefixForkNameWithOwnerName` before checking alternate fork
2. When option IS enabled, skip the alternate fork check entirely
3. Added helpful warning when a conflicting standard fork exists

### Secondary Fix: PR Mode Fork Verification

Modified `src/solve.repository.lib.mjs` lines 536-543:

```javascript
if (forkCheckResult.code !== 0 && !argv.prefixForkNameWithOwnerName) {
  // Only try alternate name if NOT using --prefix-fork-name-with-owner-name
  // When the option is enabled, we should only use the prefixed fork name
  forkCheckResult = await $`gh repo view ${alternateForkName} --json name 2>/dev/null`;
  if (forkCheckResult.code === 0) {
    actualForkName = alternateForkName;
  }
}
```

This ensures the same fix applies when verifying forks in PR/auto-continue mode.

## Expected Behavior After Fix

### Scenario 1: Prefixed Fork Doesn't Exist, Standard Fork Exists

Command:
```bash
solve URL --prefix-fork-name-with-owner-name --auto-fork
```

**Before Fix:**
- Detects `konard/-` exists
- Uses `konard/-` (wrong!)
- Fails with Compare API 404

**After Fix:**
- Detects `konard/-` exists
- Logs warning: "Standard fork konard/- exists but won't be used"
- Creates new fork `konard/emirmensitov-afk--`
- Uses the new prefixed fork
- Success!

### Scenario 2: Prefixed Fork Exists

Command:
```bash
solve URL --prefix-fork-name-with-owner-name --auto-fork
```

**Behavior (no change):**
- Detects `konard/emirmensitov-afk--` exists
- Uses `konard/emirmensitov-afk--`
- Success!

### Scenario 3: No Option Provided

Command:
```bash
solve URL --auto-fork
```

**Behavior (backward compatible):**
- Checks for standard fork `konard/-`
- If not found, checks for prefixed fork (in case user created one manually)
- Uses whichever exists, or creates standard fork
- Success!

## Files Modified

1. `src/solve.repository.lib.mjs` (lines 283-300, 536-543)
   - Fixed fork detection to not fall back to standard fork when prefix option enabled
   - Added informative warning when conflicting fork exists
   - Applied same fix to PR mode fork verification

2. `docs/case-studies/issue-724/latest-log.txt` (new file)
   - Added the latest failure log for documentation

3. `docs/case-studies/issue-724/fix-3-analysis.md` (this file)
   - Documented the third iteration of fixes

## Testing Recommendations

1. **Clean state test**: User has no forks, uses `--prefix-fork-name-with-owner-name`
   - Expected: Creates `owner-repo` format fork

2. **Conflict test**: User has standard fork, uses `--prefix-fork-name-with-owner-name`
   - Expected: Warns about standard fork, creates new prefixed fork

3. **Existing prefixed fork test**: User has prefixed fork, uses `--prefix-fork-name-with-owner-name`
   - Expected: Uses existing prefixed fork

4. **Backward compatibility test**: User has standard fork, does NOT use option
   - Expected: Uses standard fork as before

5. **PR mode test**: Continue work on PR from prefixed fork
   - Expected: Correctly identifies and uses prefixed fork

## Related Issues

- Issue #724: Original bug report
- PR #725: First fix attempt (incomplete)
- PR #735: Second fix attempt (missed fallback logic)
- PR #743: This fix (third attempt - addresses fallback bug)

## Conclusion

The root cause was a well-intentioned fallback mechanism that tried to be helpful by checking both fork naming patterns. However, when the user explicitly requested a prefixed fork via the option, this fallback actually broke the feature by using the wrong fork.

The fix ensures that when `--prefix-fork-name-with-owner-name` is enabled, the code ONLY uses or creates forks with the prefixed naming pattern, without falling back to standard forks.
