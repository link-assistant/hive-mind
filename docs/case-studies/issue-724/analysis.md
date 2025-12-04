# Case Study: Issue #724 - Fork Name Prefixing Option Bug

## Executive Summary

The `--prefix-fork-name-with-owner-name` option was designed to allow users to fork multiple repositories with the same name from different owners by creating forks with prefixed names (e.g., `konard/emirmensitov-afk--` instead of `konard/-`). However, the initial implementation (PR #725) only partially addressed the issue, leading to "Not Found (HTTP 404)" errors in multiple places where the code still tried to access the fork using the unprefixed repository name.

## Timeline of Events

### Initial Problem Discovery
**Date:** 2025-11-13 13:37:53 UTC
**Log:** `original-log.txt`

1. **13:38:00** - Fork mode enabled, checking for existing fork
2. **13:38:05** - Fork detected as `konard/-` (unprefixed name)
3. **13:38:09** - Branch `issue-1-cf02d85afe90` pushed successfully
4. **13:38:12-41** - Compare API returned HTTP 404 errors repeatedly (5 attempts)
   - The code was trying to access `repos/emirmensitov-afk/-/compare/master...issue-1-cf02d85afe90`
   - GitHub API couldn't find this because the branch was actually in `konard/-`, not `emirmensitov-afk/-`
5. **13:38:41** - PR creation failed with "GitHub compare API not ready" error

**Key Insight:** The branch was pushed to the user's fork (`konard/-`) but the compare API was being called on the base repository (`emirmensitov-afk/-`), which didn't have that branch.

### First Attempt with Option
**Date:** 2025-11-14 19:29:58 UTC
**Log:** `option-test-log.txt`

1. **19:30:05** - Fork mode enabled with `--prefix-fork-name-with-owner-name` option
2. **19:30:07** - **Still checking for branches in `konard/-`** (should have been checking in prefixed fork name)
3. **19:30:08** - Found existing branch `issue-1-cf02d85afe90` in fork
4. **19:30:16** - Branch pushed successfully
5. **19:30:19-50** - Same HTTP 404 errors on Compare API (5 attempts)
6. **19:30:50** - PR creation failed again

**Key Issue:** Even with the option enabled, the code was still using the unprefixed fork name `konard/-` instead of the expected prefixed name like `konard/emirmensitov-afk--`.

### First Solution Draft
**Date:** 2025-11-14 20:00:40 UTC
**Log:** `solution-draft-1.txt`

- PR #735 was successfully created
- Initial fix was implemented in PR #725 (merged)
- However, the fix was incomplete and didn't cover all code paths

### Second Solution Draft
**Date:** 2025-11-14 20:11:31 UTC - 20:30:12 UTC
**Log:** `solution-draft-2.txt`

- Comprehensive fix implemented across multiple files
- All remaining references to fork name updated
- CI checks passed

## Root Cause Analysis

### Primary Root Cause
The `--prefix-fork-name-with-owner-name` option was implemented in PR #725, but only updated some locations in the code. Multiple other places still used the unprefixed repository name when:

1. Checking if branches exist in the fork
2. Setting up git remotes for PR forks
3. Calling GitHub's Compare API
4. Verifying fork existence
5. Handling permission denied errors

### Secondary Issues

1. **Inconsistent Fork Name Resolution:** Different parts of the codebase had different logic for determining the fork name, leading to inconsistencies.

2. **Missing Option Propagation:** The `--prefix-fork-name-with-owner-name` option wasn't consistently passed through all function calls that needed to determine fork names.

3. **Hard-coded Assumptions:** Some code assumed the fork name would always match the base repository name.

## Affected Code Locations

Based on the PR description and logs, the following files were identified as needing fixes:

### 1. `src/solve.execution.lib.mjs` (lines 100-176)
**Issue:** Fork creation and verification used unprefixed name
**Fix:** Determine fork name based on option, use prefixed name when creating and verifying fork

### 2. `src/solve.repository.lib.mjs` (lines 454-493)
**Issue:** PR fork verification assumed unprefixed name
**Fix:** Check both prefixed and standard fork names, try expected name first

### 3. `src/solve.repository.lib.mjs` (lines 767-806)
**Issue:** pr-fork remote setup used unprefixed name
**Fix:** Determine fork repo name based on option when adding git remote

### 4. `src/solve.repo-setup.lib.mjs` (lines 24, 53-57)
**Issue:** Missing owner parameter for fork name determination
**Fix:** Pass owner parameter to `setupPrForkRemote` function

### 5. `src/solve.auto-pr.lib.mjs` (lines 381-398)
**Issue:** Permission denied handler checked for fork using unprefixed name
**Fix:** Determine fork name based on option before checking

### 6. `src/solve.branch-errors.lib.mjs` (lines 35-65)
**Issue:** Assumed fork name matched base repository name
**Fix:** Get actual fork repository name from PR data using `headRepository.name`

## Error Pattern

The consistent error pattern was:
```
Compare API error: {"message":"Not Found","documentation_url":"...","status":"404"}
```

This occurred when the code tried to access GitHub API endpoints using the base repository path instead of the fork path, or using the wrong fork name format.

## Solution Strategy

The comprehensive fix ensures that when `--prefix-fork-name-with-owner-name` is enabled:

1. Fork is created with `gh repo fork --fork-name ${owner}-${repo}`
2. All GitHub API calls use the correct prefixed repository name
3. Branch checks look in the right fork repository
4. Error messages display accurate repository URLs
5. Git remotes are set up with the correct fork URL
6. The compare API uses the correct repository reference

## Testing Considerations

To verify the fix works correctly, the following scenarios should be tested:

1. **With option enabled:**
   - Fork creation should create `${owner}-${repo}` format
   - All API calls should use the prefixed name
   - Branch operations should work correctly
   - PR creation should succeed

2. **Without option (backward compatibility):**
   - Fork creation should use standard name
   - All API calls should use unprefixed name
   - Existing functionality should work as before

3. **Edge cases:**
   - Repository names that are just "-" or empty
   - Special characters in owner or repo names
   - Switching between prefixed and non-prefixed forks

## Lessons Learned

1. **Feature Implementation Completeness:** When adding a new option that changes behavior across the codebase, all code paths must be identified and updated.

2. **Centralized Configuration:** Fork name determination logic should ideally be centralized in one place to prevent inconsistencies.

3. **Comprehensive Testing:** Integration tests should cover new options across all major code paths.

4. **Error Message Quality:** The "Compare API not ready" error was misleading - it wasn't about API readiness but about using the wrong repository reference.

## Recommendations

1. **Code Refactoring:** Consider creating a centralized `ForkManager` class that handles all fork name resolution logic based on options.

2. **Configuration Validation:** Add validation to ensure that when the option is enabled, all components are correctly configured.

3. **Integration Tests:** Add automated tests that exercise the full workflow with the option enabled.

4. **Documentation:** Update user documentation to clearly explain when and how to use the `--prefix-fork-name-with-owner-name` option.

5. **Backward Compatibility:** Ensure that the default behavior (without the option) remains unchanged to avoid breaking existing workflows.

## Conclusion

The bug was caused by incomplete implementation of the `--prefix-fork-name-with-owner-name` feature. The initial fix (PR #725) only addressed some code paths, while others continued to use the unprefixed fork name, leading to HTTP 404 errors. The comprehensive fix in PR #735 addresses all identified locations where fork names are used, ensuring consistent behavior throughout the codebase.
