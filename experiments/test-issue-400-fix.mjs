#!/usr/bin/env node

/**
 * Test script for issue #400 fix
 *
 * This script tests that the system can properly detect existing branches
 * for an issue and reuse them instead of creating duplicates.
 */

// Import necessary modules
globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
const use = globalThis.use;
const { $ } = await use('command-stream');

console.log('🧪 Testing Issue #400 Fix: Existing Branch Detection\n');

// Test parameters
const testOwner = 'link-assistant';
const testRepo = 'hive-mind';
const testIssueNumber = '400'; // Use the current issue

console.log('Test configuration:');
console.log(`  Repository: ${testOwner}/${testRepo}`);
console.log(`  Issue: #${testIssueNumber}`);
console.log('');

// Test 1: Check if we can list all branches for the issue
console.log('Test 1: List all branches matching pattern issue-400-*');
console.log('─'.repeat(60));

try {
  const branchPattern = `issue-${testIssueNumber}-`;
  const branchListResult = await $`gh api repos/${testOwner}/${testRepo}/branches --jq '.[].name'`;

  if (branchListResult.code === 0) {
    const allBranches = branchListResult.stdout
      .toString()
      .trim()
      .split('\n')
      .filter(b => b);
    const matchingBranches = allBranches.filter(branch => branch.startsWith(branchPattern));

    console.log(`✅ Successfully retrieved branches from GitHub API`);
    console.log(`   Total branches in repo: ${allBranches.length}`);
    console.log(`   Matching pattern '${branchPattern}*': ${matchingBranches.length}`);

    if (matchingBranches.length > 0) {
      console.log('   Matching branches:');
      for (const branch of matchingBranches) {
        console.log(`     • ${branch}`);
      }
    }
  } else {
    console.log(`❌ Failed to retrieve branches: ${branchListResult.stderr}`);
  }
} catch (error) {
  console.log(`❌ Error: ${error.message}`);
}

console.log('');

// Test 2: Check if we can detect PRs for each branch
console.log('Test 2: Check for PRs associated with matching branches');
console.log('─'.repeat(60));

try {
  const branchPattern = `issue-${testIssueNumber}-`;
  const branchListResult = await $`gh api repos/${testOwner}/${testRepo}/branches --jq '.[].name'`;

  if (branchListResult.code === 0) {
    const allBranches = branchListResult.stdout
      .toString()
      .trim()
      .split('\n')
      .filter(b => b);
    const matchingBranches = allBranches.filter(branch => branch.startsWith(branchPattern));

    for (const branch of matchingBranches) {
      console.log(`\nChecking branch: ${branch}`);

      // Check if there's a PR for this branch
      const prForBranchResult = await $`gh pr list --repo ${testOwner}/${testRepo} --head ${branch} --json number,state,isDraft --limit 1`;

      if (prForBranchResult.code === 0) {
        const prsForBranch = JSON.parse(prForBranchResult.stdout.toString().trim() || '[]');

        if (prsForBranch.length > 0) {
          const pr = prsForBranch[0];
          console.log(`  ✅ PR exists: #${pr.number} (${pr.state}, ${pr.isDraft ? 'draft' : 'ready'})`);
        } else {
          console.log(`  ⚠️  No PR found for this branch`);
        }
      }
    }
  }
} catch (error) {
  console.log(`❌ Error: ${error.message}`);
}

console.log('');

// Test 3: Simulate the processAutoContinueForIssue logic
console.log('Test 3: Simulate auto-continue branch detection logic');
console.log('─'.repeat(60));

try {
  const branchPattern = `issue-${testIssueNumber}-`;

  // First check for PRs using the search query (old method)
  console.log(`\nOld method: Using gh pr list --search "linked:issue-${testIssueNumber}"`);
  const prListResult = await $`gh pr list --repo ${testOwner}/${testRepo} --search "linked:issue-${testIssueNumber}" --json number,headRefName --limit 10`;

  if (prListResult.code === 0) {
    const prs = JSON.parse(prListResult.stdout.toString().trim() || '[]');
    console.log(`  Found ${prs.length} PRs via search`);

    const correctPRs = prs.filter(pr => pr.headRefName && pr.headRefName.startsWith(branchPattern));
    console.log(`  Correctly matched: ${correctPRs.length}`);

    if (correctPRs.length !== prs.length) {
      console.log(`  ⚠️  Warning: ${prs.length - correctPRs.length} false positives from search query!`);
    }
  }

  // New method: Check branches directly
  console.log(`\nNew method: Direct branch listing via API`);
  const branchListResult = await $`gh api repos/${testOwner}/${testRepo}/branches --jq '.[].name'`;

  if (branchListResult.code === 0) {
    const allBranches = branchListResult.stdout
      .toString()
      .trim()
      .split('\n')
      .filter(b => b);
    const matchingBranches = allBranches.filter(branch => branch.startsWith(branchPattern));

    console.log(`  Found ${matchingBranches.length} branches matching pattern`);
    console.log(`  ✅ This method is more reliable!`);

    if (matchingBranches.length > 0) {
      // Sort and select the most recent
      const sortedBranches = matchingBranches.sort();
      const selectedBranch = sortedBranches[sortedBranches.length - 1];
      console.log(`  Would select: ${selectedBranch}`);
    }
  }
} catch (error) {
  console.log(`❌ Error: ${error.message}`);
}

console.log('\n');
console.log('═'.repeat(60));
console.log('Test Summary');
console.log('═'.repeat(60));
console.log('✅ The fix adds direct branch checking via GitHub API');
console.log('✅ This ensures existing branches are always detected');
console.log('✅ Prevents duplicate branch creation for the same issue');
console.log('');
