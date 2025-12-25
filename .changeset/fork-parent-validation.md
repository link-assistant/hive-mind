---
'@link-assistant/hive-mind': minor
---

Add fork parent validation to prevent nested fork hierarchy issues (#967)

This release adds early validation of fork parent relationships to prevent issues where a fork was created from an intermediate fork (fork of a fork) instead of directly from the intended upstream repository.

**Problem solved:**
When a user's fork was created from an intermediate fork (e.g., `user/repo` forked from `someone-else/repo` which was itself forked from `upstream/repo`), any pull requests created would include all commits that exist in the intermediate fork but not in the upstream. This could result in PRs with hundreds or thousands of unexpected commits.

**Case study (Issue #967):**
A fork `konard/zamtmn-zcad` was created from `veb86/zcadvelecAI` (intermediate fork with 1,678 extra commits) instead of `zamtmn/zcad` (the upstream). This resulted in a PR with 1,681 commits instead of the expected 3 commits.

**Changes:**

- **New function `validateForkParent()`**: Validates that a fork's parent matches the expected upstream repository before using it. Checks both the immediate parent and ultimate source (root) of the fork hierarchy.

- **Early validation**: Fork parent is now validated immediately after an existing fork is found, BEFORE syncing or creating branches. This prevents wasted work and provides clear error messages early.

- **Detailed error messages**: When a fork parent mismatch is detected, users receive comprehensive information including:
  - The actual fork hierarchy (parent and source repositories)
  - Why this is a problem (unexpected commits in PRs)
  - Three concrete fix options:
    1. Delete the problematic fork and create a fresh one
    2. Use `--prefix-fork-name-with-owner-name` to create a new fork with a different name
    3. Work directly on the repository with `--no-fork` if you have write access

- **Unit tests**: Added comprehensive test suite (`tests/test-fork-parent-validation.mjs`) with 10 tests covering the validation logic, error handling, and documentation.

**Technical details:**

- Uses GitHub API to fetch fork relationship: `gh api repos/{fork} --jq '{fork: .fork, parent: .parent.full_name, source: .source.full_name}'`
- Validates in two code paths: when finding existing forks (strict error) and when using forkOwner from PR mode (warning only)
- Reports validation errors to Sentry for monitoring
