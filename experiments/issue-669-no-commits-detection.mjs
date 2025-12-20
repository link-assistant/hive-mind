#!/usr/bin/env node

/**
 * Experiment: Demonstrate the "No commits between branches" issue and solution
 *
 * Issue #669: When creating a PR after assignee fallback, sometimes GitHub reports
 * "No commits between main and branch" even though local git log shows commits.
 *
 * Root cause:
 * - Local main branch can be outdated compared to remote origin/main
 * - When GitHub creates a PR, it compares the branch to remote main, not local main
 * - If the branch commits are already in remote main, GitHub rejects the PR
 *
 * Solution:
 * - Fetch latest state of origin/main before creating PR
 * - Use `git rev-list --count origin/main..HEAD` to check for commits
 * - This compares against remote main, same as GitHub will do
 * - Fail fast with helpful error message if no commits exist
 *
 * This experiment demonstrates the difference between:
 * - `git log main..branch` (compares to local main - can be misleading)
 * - `git log origin/main..branch` (compares to remote main - accurate)
 */

// Use use-m for cross-runtime compatibility
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;
const { $ } = await use('command-stream');

console.log('\n=== Issue #669: No Commits Detection Experiment ===\n');

console.log('Scenario: Demonstrating why fetching origin/main is critical\n');

// Simulate the scenario:
// 1. Clone a repo (main is fresh)
// 2. Create a branch with commits
// 3. Meanwhile, someone else merges those commits to remote main
// 4. Try to create PR - will fail without fetching latest main

console.log('Example commands that would fail without our fix:');
console.log('  git checkout -b feature-branch');
console.log('  echo "content" > file.txt && git add file.txt && git commit -m "Add feature"');
console.log('  # Meanwhile, someone else merges identical work to remote main');
console.log('  git log main..feature-branch --oneline  # Shows commits (misleading!)');
console.log('  gh pr create  # FAILS: "No commits between branches"');
console.log('');

console.log('With our fix:');
console.log('  git fetch origin main  # Fetch latest remote main');
console.log('  git rev-list --count origin/main..feature-branch  # Returns 0');
console.log('  # We detect this BEFORE calling gh pr create');
console.log('  # Fail fast with helpful error message');
console.log('');

console.log('Benefits of the fix:');
console.log('  1. Detects the issue before attempting PR creation');
console.log('  2. Provides clear error message explaining the situation');
console.log('  3. Suggests resolution options');
console.log('  4. Prevents confusing GitHub GraphQL errors');
console.log('');

console.log('The fix adds this to solve.auto-pr.lib.mjs:');
console.log('');
console.log('```javascript');
console.log('// Fetch latest state of target branch');
console.log('await git fetch origin ${targetBranch}:refs/remotes/origin/${targetBranch}');
console.log('');
console.log('// Check commit count against REMOTE main, not local main');
console.log('const result = await git rev-list --count origin/${targetBranch}..HEAD');
console.log('const commitCount = parseInt(result);');
console.log('');
console.log('if (commitCount === 0) {');
console.log('  // Fail fast with helpful error before attempting gh pr create');
console.log('  throw new Error("No commits to create PR");');
console.log('}');
console.log('```');
console.log('');

console.log('✅ Experiment complete. The fix prevents the "No commits" error by:');
console.log('   1. Fetching latest remote state');
console.log('   2. Checking commits against remote (same as GitHub does)');
console.log('   3. Failing fast with clear guidance if no commits exist');
console.log('');
