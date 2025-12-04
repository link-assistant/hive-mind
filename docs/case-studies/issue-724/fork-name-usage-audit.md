# Fork Name Usage Audit - Issue #724

## Purpose
This document catalogs all places in the codebase where fork repository names are used, and tracks whether they properly support the `--prefix-fork-name-with-owner-name` option.

## Summary
- ✅ **Fixed:** Location correctly uses prefixed fork name when option is enabled
- ⚠️ **Needs Fix:** Location uses hardcoded `${user}/${repo}` pattern
- ℹ️ **Informational:** Location is for user messages only (low priority)

## Audit Results

### src/solve.execution.lib.mjs
✅ **Lines 103-176** - Fork creation and verification
- Uses `forkRepoName` variable determined by `argv.prefixForkNameWithOwnerName`
- Creates fork with `--fork-name` when option is enabled
- All API calls use correct fork name

### src/solve.repository.lib.mjs
✅ **Lines 273-318** - Fork detection and creation for auto-fork
- Uses `expectedForkName` and `alternateForkName` variables
- Tries both standard and prefixed names when checking

✅ **Lines 508-550** - PR fork verification
- Uses `expectedForkName` and `alternateForkName`
- Tries both naming patterns

✅ **Lines 842-851** - pr-fork remote setup
- Uses `prForkRepoName` determined by option
- Correctly adds remote with prefixed name when needed

### src/solve.auto-pr.lib.mjs
✅ **Lines 388-398** - Permission denied handler fork check
- Uses `forkRepoName` variable determined by option
- Correctly checks for fork existence

✅ **Lines 68-88** - Fork mode error messages (Compare API)
- Uses `forkedRepo` variable which contains correct fork name
- Error messages show correct repository paths

✅ **Lines 94-115** - Branch verification in fork
- Uses `repoToCheck` variable that contains correct fork name

⚠️ **Lines 431, 459** - Permission denied help messages
- **Issue:** Hardcoded `${currentUser}/${repo}` in user-facing messages
- **Impact:** Messages show wrong fork name when option is enabled
- **Fix needed:** Use `${currentUser}/${forkRepoName}` (variable already exists on line 389)

### src/solve.branch-errors.lib.mjs
✅ **Lines 40-50** - Get actual fork repository name from PR
- Uses `prData.headRepository.name` to get real fork name
- No assumptions about naming

✅ **Lines 85-92** - User fork check
- Uses `userForkRepoName` determined by option
- Correctly checks user's fork

✅ **Lines 150-227** - Error messages showing fork paths
- Uses `forkRepoName` or `displayForkRepo` variables
- Shows correct fork repository name

⚠️ **Line 205** - Help message about using fork
- **Issue:** Uses `${forkOwner}/${repo}` in message
- **Impact:** Message shows wrong fork name when option is enabled
- **Fix needed:** Use `${forkOwner}/${forkRepoName}` (variable already determined earlier)

### src/solve.auto-continue.lib.mjs
✅ **Lines 329-346** - Fork check for auto-continue
- Uses `forkRepoName` determined by option
- Correctly checks for fork existence

### src/solve.repo-setup.lib.mjs
✅ **Lines 24, 313** - Pass owner parameter to setupPrForkRemote
- Correctly passes owner parameter needed for fork name determination

### src/solve.mjs
⚠️ **Lines 346, 420** - Fork PR detection messages
- **Issue:** Uses `${forkOwner}/${repo}` in log messages
- **Impact:** Messages show wrong fork name for prefixed forks
- **Fix needed:** Get actual fork name from `prData.headRepository.name`
- **Note:** This is informational logging, not critical for functionality

### src/github.lib.mjs
⚠️ **Line 315** - Permission error help message
- **Issue:** Uses `${currentUser}/${repo}` in error message
- **Impact:** Message shows wrong fork name when option is enabled
- **Challenge:** Function doesn't have access to `argv` or `owner`
- **Fix options:**
  1. Pass `argv` and `owner` to function (breaking change)
  2. Add note that actual fork name may be different if using options
  3. Leave as-is (informational message, not critical)

## Functional vs. Informational Issues

### Functional (Critical) - All Fixed ✅
These affect actual operations and would cause failures:
- Fork creation with wrong name
- API calls to wrong repository
- Git remote setup with wrong URL
- Branch verification in wrong repository

### Informational (Low Priority) - Some Remaining ⚠️
These only affect user-facing messages and help text:
- src/solve.auto-pr.lib.mjs lines 431, 459
- src/solve.branch-errors.lib.mjs line 205
- src/solve.mjs lines 346, 420
- src/github.lib.mjs line 315

## Recommendations

### High Priority
Fix the informational messages in:
1. **src/solve.auto-pr.lib.mjs** (lines 431, 459) - Easy fix, variable already exists
2. **src/solve.branch-errors.lib.mjs** (line 205) - Easy fix, variable already exists

### Medium Priority
Fix the informational messages in:
3. **src/solve.mjs** (lines 346, 420) - Need to extract from PR data

### Low Priority
4. **src/github.lib.mjs** (line 315) - Would require function signature change

## Testing Checklist

To verify all fork name usage is correct:

- [ ] Test fork creation with option enabled
- [ ] Test fork creation without option
- [ ] Test existing fork detection with prefixed name
- [ ] Test existing fork detection with standard name
- [ ] Test PR from prefixed fork
- [ ] Test PR from standard fork
- [ ] Test error messages show correct fork names
- [ ] Test help messages show correct fork names
- [ ] Verify Compare API uses correct repository
- [ ] Verify branch verification uses correct repository
- [ ] Verify git remotes use correct URLs

## Conclusion

All **functional** issues have been fixed in the current PR. The remaining issues are in **informational messages** that show the wrong fork name to users but don't affect actual operations. These should be fixed for consistency and user experience, but they don't cause the "Not Found (HTTP 404)" errors that were the root cause of the issue.
