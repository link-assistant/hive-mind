#!/usr/bin/env node

// Test script to verify branch pagination issue

const { $ } = await (await import('command-stream')).default;

const owner = 'link-assistant';
const repo = 'hive-mind';

console.log('Testing branch pagination for link-assistant/hive-mind...\n');

// Test 1: Current approach (no pagination)
console.log('=== Test 1: Current approach (no pagination) ===');
const noPaginationResult = await $`gh api repos/${owner}/${repo}/branches --jq '.[].name'`;
if (noPaginationResult.code === 0) {
  const branches = noPaginationResult.stdout
    .toString()
    .trim()
    .split('\n')
    .filter(b => b);
  console.log(`Found ${branches.length} branches (default page size)`);
  console.log('First 5 branches:', branches.slice(0, 5));
  console.log('Last 5 branches:', branches.slice(-5));
}

// Test 2: With pagination (all pages)
console.log('\n=== Test 2: With pagination (all pages) ===');
const withPaginationResult = await $`gh api --paginate repos/${owner}/${repo}/branches --jq '.[].name'`;
if (withPaginationResult.code === 0) {
  const branches = withPaginationResult.stdout
    .toString()
    .trim()
    .split('\n')
    .filter(b => b);
  console.log(`Found ${branches.length} branches (with --paginate)`);
  console.log('First 5 branches:', branches.slice(0, 5));
  console.log('Last 5 branches:', branches.slice(-5));
}

// Test 3: Check for issue-357 branches specifically
console.log('\n=== Test 3: Search for issue-357 branches ===');
const issue357Result = await $`gh api --paginate repos/${owner}/${repo}/branches --jq '.[].name'`;
if (issue357Result.code === 0) {
  const allBranches = issue357Result.stdout
    .toString()
    .trim()
    .split('\n')
    .filter(b => b);
  const issue357Branches = allBranches.filter(b => b.startsWith('issue-357-'));
  console.log(`Found ${issue357Branches.length} branches for issue #357:`);
  for (const branch of issue357Branches) {
    console.log(`  • ${branch}`);
  }
}

// Test 4: Check for issue-408 branches specifically
console.log('\n=== Test 4: Search for issue-408 branches ===');
const issue408Result = await $`gh api --paginate repos/${owner}/${repo}/branches --jq '.[].name'`;
if (issue408Result.code === 0) {
  const allBranches = issue408Result.stdout
    .toString()
    .trim()
    .split('\n')
    .filter(b => b);
  const issue408Branches = allBranches.filter(b => b.startsWith('issue-408-'));
  console.log(`Found ${issue408Branches.length} branches for issue #408:`);
  for (const branch of issue408Branches) {
    console.log(`  • ${branch}`);
  }
}

console.log('\n=== Summary ===');
console.log('The --paginate flag is needed to fetch all branches from the repository.');
console.log('Without it, only the first page (default 30 items) is returned.');
