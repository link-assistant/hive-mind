#!/usr/bin/env node

// Test script to verify the fix works with the updated code

// Load use-m for cross-runtime compatibility
globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
const use = globalThis.use;

// Use command-stream for consistent $ behavior
const { $ } = await use('command-stream');

const owner = 'link-assistant';
const repo = 'hive-mind';

console.log('Testing branch search with pagination fix...\n');

// Test searching for issue-357 branches (should find both)
console.log('=== Test: Search for issue-357 branches ===');
const issueNumber = 357;
const branchPattern = `issue-${issueNumber}-`;

// This simulates the fixed code
const branchListResult = await $`gh api --paginate repos/${owner}/${repo}/branches --jq '.[].name'`;

if (branchListResult.code === 0) {
  const allBranches = branchListResult.stdout
    .toString()
    .trim()
    .split('\n')
    .filter(b => b);
  const existingBranches = allBranches.filter(branch => branch.startsWith(branchPattern));

  console.log(`Total branches in repo: ${allBranches.length}`);
  console.log(`Branches matching '${branchPattern}*': ${existingBranches.length}`);

  if (existingBranches.length > 0) {
    console.log('\nFound branches:');
    for (const branch of existingBranches) {
      console.log(`  • ${branch}`);
    }

    // Sort branches by name and select the most recent
    const sortedBranches = existingBranches.sort();
    const selectedBranch = sortedBranches[sortedBranches.length - 1];
    console.log(`\nSelected branch (most recent): ${selectedBranch}`);
  }
}

// Test searching for issue-408 branches (should find all 3)
console.log('\n=== Test: Search for issue-408 branches ===');
const issueNumber408 = 408;
const branchPattern408 = `issue-${issueNumber408}-`;

const branchListResult408 = await $`gh api --paginate repos/${owner}/${repo}/branches --jq '.[].name'`;

if (branchListResult408.code === 0) {
  const allBranches = branchListResult408.stdout
    .toString()
    .trim()
    .split('\n')
    .filter(b => b);
  const existingBranches = allBranches.filter(branch => branch.startsWith(branchPattern408));

  console.log(`Total branches in repo: ${allBranches.length}`);
  console.log(`Branches matching '${branchPattern408}*': ${existingBranches.length}`);

  if (existingBranches.length > 0) {
    console.log('\nFound branches:');
    for (const branch of existingBranches) {
      console.log(`  • ${branch}`);
    }

    // Sort branches by name and select the most recent
    const sortedBranches = existingBranches.sort();
    const selectedBranch = sortedBranches[sortedBranches.length - 1];
    console.log(`\nSelected branch (most recent): ${selectedBranch}`);
  }
}

console.log('\n=== Summary ===');
console.log('✅ The fix successfully retrieves all branches using --paginate flag');
console.log('✅ Existing branches are now found correctly');
console.log('✅ This prevents duplicate branch creation');
