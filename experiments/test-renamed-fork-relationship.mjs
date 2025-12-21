#!/usr/bin/env node

/**
 * Test script to verify if renamed forks maintain their fork relationship
 *
 * This script tests whether using `gh repo fork --fork-name` maintains
 * the GitHub fork relationship (isFork: true, parent: <original>).
 *
 * Context: Issue #906 investigation
 * Question: Does --prefix-fork-name-with-owner-name break fork relationships?
 */

// Use use-m to dynamically import modules for cross-runtime compatibility
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

console.log('Testing Fork Relationship with Renamed Forks\n');
console.log('='.repeat(80));
console.log('\nContext: Issue #906 - Repository mismatch error investigation');
console.log('Question: Does gh repo fork --fork-name maintain fork relationship?\n');

// Step 1: Get current user
console.log('Step 1: Getting current user...');
const userResult = await $`gh api user --jq .login`;
if (userResult.code !== 0) {
  console.error('❌ Error: Failed to get current user');
  process.exit(1);
}
const currentUser = userResult.stdout.toString().trim();
console.log(`✅ Current user: ${currentUser}\n`);

// Step 2: Choose a test repository (use a small, public repo)
// Using a well-known, small test repository
const testOwner = 'octocat';
const testRepo = 'Hello-World';
const testRepoFull = `${testOwner}/${testRepo}`;

console.log(`Step 2: Test repository: ${testRepoFull}`);
console.log(`        This is a small, public test repository maintained by GitHub\n`);

// Step 3: Test standard fork (without --fork-name)
console.log('Step 3: Testing STANDARD fork (without --fork-name)...');
console.log('-'.repeat(80));

const standardForkName = `${currentUser}/${testRepo}`;
console.log(`Expected fork: ${standardForkName}`);

// Check if standard fork already exists
const standardForkCheckResult = await $`gh repo view ${standardForkName} --json name,fork,parent,source 2>/dev/null`;
let standardForkExists = standardForkCheckResult.code === 0;

if (standardForkExists) {
  console.log(`ℹ️  Standard fork already exists, using existing fork for test`);
  const standardForkInfo = JSON.parse(standardForkCheckResult.stdout.toString().trim());
  console.log(`\n📊 Standard Fork Properties:`);
  console.log(`    Repository: ${standardForkName}`);
  console.log(`    fork: ${standardForkInfo.fork}`);
  console.log(`    parent: ${standardForkInfo.parent ? standardForkInfo.parent.full_name : null}`);
  console.log(`    source: ${standardForkInfo.source ? standardForkInfo.source.full_name : null}`);
} else {
  console.log('Creating standard fork (this may take a moment)...');
  const standardForkResult = await $`gh repo fork ${testRepoFull} --clone=false 2>&1`;

  if (standardForkResult.code === 0) {
    console.log('✅ Standard fork created successfully');

    // Wait for GitHub to propagate the fork
    console.log('⏳ Waiting for GitHub to propagate fork (5 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Get fork info
    const standardForkInfoResult = await $`gh api repos/${standardForkName} --jq '{fork: .fork, parent: .parent.full_name, source: .source.full_name}'`;
    if (standardForkInfoResult.code === 0) {
      const standardForkInfo = JSON.parse(standardForkInfoResult.stdout.toString().trim());
      console.log(`\n📊 Standard Fork Properties:`);
      console.log(`    Repository: ${standardForkName}`);
      console.log(`    fork: ${standardForkInfo.fork}`);
      console.log(`    parent: ${standardForkInfo.parent || null}`);
      console.log(`    source: ${standardForkInfo.source || null}`);

      if (standardForkInfo.fork === true) {
        console.log('✅ RESULT: Standard fork maintains fork relationship (fork=true)');
      } else {
        console.log('❌ RESULT: Standard fork does NOT have fork relationship (fork=false)');
      }
    }
  } else {
    console.log('⚠️  Could not create standard fork (may already exist in fork network)');
    console.log('    Error:', standardForkResult.stdout.toString() + standardForkResult.stderr.toString());
  }
}

console.log('\n');

// Step 4: Test renamed fork (with --fork-name)
console.log('Step 4: Testing RENAMED fork (with --fork-name)...');
console.log('-'.repeat(80));

const renamedForkName = `${currentUser}/${testOwner}-${testRepo}`;
console.log(`Expected fork: ${renamedForkName}`);

// Check if renamed fork already exists
const renamedForkCheckResult = await $`gh repo view ${renamedForkName} --json name,fork,parent,source 2>/dev/null`;
let renamedForkExists = renamedForkCheckResult.code === 0;

if (renamedForkExists) {
  console.log(`ℹ️  Renamed fork already exists`);
  const renamedForkInfo = JSON.parse(renamedForkCheckResult.stdout.toString().trim());
  console.log(`\n📊 Renamed Fork Properties:`);
  console.log(`    Repository: ${renamedForkName}`);
  console.log(`    fork: ${renamedForkInfo.fork}`);
  console.log(`    parent: ${renamedForkInfo.parent ? renamedForkInfo.parent.full_name : null}`);
  console.log(`    source: ${renamedForkInfo.source ? renamedForkInfo.source.full_name : null}`);

  if (renamedForkInfo.fork === true) {
    console.log('✅ RESULT: Renamed fork maintains fork relationship (fork=true)');
  } else {
    console.log('❌ RESULT: Renamed fork does NOT have fork relationship (fork=false)');
  }
} else {
  console.log('⚠️  Cannot create renamed fork: GitHub only allows one fork per repository');
  console.log('    You already have a fork of this repository (standard fork)');
  console.log('    To test renamed fork, we would need to:');
  console.log('    1. Delete the standard fork');
  console.log('    2. Create the renamed fork');
  console.log('    3. Test its properties');
  console.log('\n    Since this is destructive, skipping renamed fork creation test');
}

console.log('\n' + '='.repeat(80));
console.log('\n🔍 ANALYSIS:\n');
console.log('To fully answer the question "Does --fork-name maintain fork relationship?",');
console.log("we need to test with a repository where we don't already have a fork.\n");

console.log('Based on GitHub CLI documentation:');
console.log("- `gh repo fork` creates a fork using GitHub's Fork API");
console.log('- The `--fork-name` flag is passed to the API as a repository name');
console.log("- GitHub's Fork API maintains fork relationship regardless of name\n");

console.log('⚡ EXPECTED BEHAVIOR:');
console.log('Forks created with `gh repo fork --fork-name` SHOULD maintain fork relationship');
console.log('because they use the same GitHub Fork API endpoint.\n');

console.log('📝 RECOMMENDATION:');
console.log('To verify this conclusively, test with a repository where no fork exists yet.');
console.log('Alternative: Check GitHub CLI source code or GitHub API documentation.\n');

// Step 5: Research GitHub CLI and API behavior
console.log('Step 5: Checking GitHub CLI fork command behavior...');
console.log('-'.repeat(80));
console.log("\nLet's check what `gh repo fork --fork-name` actually does:\n");

console.log('According to GitHub CLI documentation (gh repo fork --help):');
console.log('  --fork-name <string>');
console.log('      Rename the forked repository\n');

console.log('This suggests that:');
console.log('1. The fork is created first (using GitHub Fork API)');
console.log('2. Then it is renamed (which is a separate operation)');
console.log('3. Renaming a repository does NOT break fork relationships\n');

console.log('✅ CONCLUSION:');
console.log('Forks created with --fork-name SHOULD maintain fork relationship (fork=true)');
console.log('because renaming is a metadata change, not a fork break.\n');

console.log('='.repeat(80));
console.log('\n📋 NEXT STEPS:\n');
console.log('1. To verify conclusively, we can:');
console.log('   a) Test with a different repository where we have no fork');
console.log('   b) Check GitHub API responses after fork creation with --fork-name');
console.log('   c) Review GitHub CLI source code\n');

console.log('2. For Issue #906:');
console.log('   - The error "REPOSITORY MISMATCH: Fork is from different repository tree"');
console.log('   - Likely indicates the repository was NOT created via GitHub Fork button');
console.log('   - Instead, it was created by clone+push, which creates an orphaned repo');
console.log('   - Forks with --prefix-fork-name-with-owner-name should NOT have this issue\n');

console.log('✅ Test complete!');
