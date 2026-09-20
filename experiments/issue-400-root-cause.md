# Issue #400 Root Cause Analysis

## Problem Statement

When solving issue #357, the system created a new branch `issue-357-4b779939` even though a branch `issue-357-f71743cd` already existed for the same issue.

## Root Cause

The `processAutoContinueForIssue` function in `src/solve.auto-continue.lib.mjs` only searches for existing branches in two scenarios:

1. **Fork mode** (lines 308-349): Checks for branches in the fork matching `issue-{issueNumber}-*`
2. **PR search** (line 353): Uses `gh pr list --search "linked:issue-{issueNumber}"`

### The Gap

**Missing:** The system does NOT check for branches matching `issue-{issueNumber}-*` in the **main repository** (only in forks).

This means if a branch exists in the main repo but:

- Has no PR yet, OR
- Has a PR that's not properly linked to the issue

Then the branch won't be found, and a duplicate branch will be created.

## What Happened in Issue #357

1. Branch `issue-357-f71743cd` already existed
2. System ran: `gh pr list --search "linked:issue-357"`
3. The search returned 10 PRs, but they were all for different issues (393, 382, 381, etc.)
4. Since no matching branch was found, new branch `issue-357-4b779939` was created

## Why the PR Search Returned Wrong Results

The `--search "linked:issue-357"` query was finding PRs that were linked to issues containing "357" in their number or other issues cross-referenced with #357, not specifically PRs for issue #357.

## The Fix

Add branch checking for the main repository similar to fork mode:

1. Check for PRs linked to the issue (existing)
2. **NEW:** Check for branches matching `issue-{issueNumber}-*` in the main repository
3. If matching branches exist:
   - Check if they have PRs
   - If yes, use the PR
   - If no, check if we should reuse the branch or create new one

This ensures we never create duplicate branches for the same issue.
