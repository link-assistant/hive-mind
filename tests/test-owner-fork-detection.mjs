#!/usr/bin/env node

/**
 * Test suite for owner fork detection (Issue #1206)
 *
 * Tests that the setupRepository function correctly detects when the
 * current user is the owner of the repository and fails with a helpful
 * error message when --fork is used, suggesting --auto-fork instead.
 * GitHub returns HTTP 403 when users attempt to fork their own repositories.
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const srcDir = join(__dirname, '..', 'src');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

// Test 1: Check that owner detection code exists in setupRepository
runTest('owner detection exists in setupRepository', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  if (!content.includes('currentUser === owner')) {
    throw new Error('Owner detection check (currentUser === owner) not found');
  }
});

// Test 2: Check that owner detection references Issue #1206
runTest('owner detection references issue #1206', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  if (!content.includes('Issue #1206')) {
    throw new Error('Owner detection should reference Issue #1206');
  }
});

// Test 3: Check that owner detection occurs BEFORE fork conflict detection
runTest('owner detection occurs before fork conflict detection', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  const ownerCheckIndex = content.indexOf('currentUser === owner');
  const forkConflictIndex = content.indexOf('Detecting fork conflicts');

  if (ownerCheckIndex === -1) {
    throw new Error('Owner detection check not found');
  }
  if (forkConflictIndex === -1) {
    throw new Error('Fork conflict detection not found');
  }
  if (ownerCheckIndex > forkConflictIndex) {
    throw new Error('Owner detection must occur BEFORE fork conflict detection to prevent unnecessary API calls');
  }
});

// Test 4: Check that owner detection fails with safeExit (not silently skipping)
runTest('owner detection fails with error when --fork is used', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  const ownerCheckStart = content.indexOf('if (currentUser === owner)');
  if (ownerCheckStart === -1) {
    throw new Error('Owner detection check not found');
  }

  // Check that it calls safeExit(1, ...) to fail explicitly
  const ownerBlock = content.substring(ownerCheckStart, ownerCheckStart + 1500);
  if (!ownerBlock.includes('safeExit(1')) {
    throw new Error('Owner detection should call safeExit(1) to fail when --fork is used');
  }
});

// Test 5: Check that owner detection error message explains the problem
runTest('owner detection error explains cannot fork own repository', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  const ownerCheckStart = content.indexOf('if (currentUser === owner)');
  const ownerBlock = content.substring(ownerCheckStart, ownerCheckStart + 1500);

  if (!ownerBlock.includes('CANNOT FORK OWN REPOSITORY')) {
    throw new Error('Error message should clearly state cannot fork own repository');
  }
});

// Test 6: Check that owner detection suggests --auto-fork as alternative
runTest('owner detection suggests --auto-fork alternative', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  const ownerCheckStart = content.indexOf('if (currentUser === owner)');
  const ownerBlock = content.substring(ownerCheckStart, ownerCheckStart + 1500);

  if (!ownerBlock.includes('--auto-fork')) {
    throw new Error('Error message should suggest --auto-fork as an alternative');
  }
});

// Test 7: Check that owner detection provides multiple solution options
runTest('owner detection provides multiple solution options', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  const ownerCheckStart = content.indexOf('if (currentUser === owner)');
  const ownerBlock = content.substring(ownerCheckStart, ownerCheckStart + 1500);

  if (!ownerBlock.includes('Option 1')) {
    throw new Error('Should provide Option 1 for --auto-fork');
  }
  if (!ownerBlock.includes('Option 2')) {
    throw new Error('Should provide Option 2 for working without fork');
  }
});

// Test 8: Check that owner detection mentions HTTP 403 in comments
runTest('code comments explain HTTP 403 issue', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  // The comment should explain WHY owner detection is needed
  if (!content.includes('HTTP 403')) {
    throw new Error('Comments should explain the HTTP 403 error from GitHub');
  }
});

// Test 9: Verify the auto-fork path in solve.mjs already checks permissions
runTest('auto-fork path checks write access before forking', () => {
  const solvePath = join(srcDir, 'solve.mjs');
  const content = execSync(`cat ${solvePath}`, { encoding: 'utf8' });

  // auto-fork should check permissions before enabling fork mode
  if (!content.includes('autoFork') || !content.includes('hasWriteAccess')) {
    throw new Error('auto-fork should check write access before enabling fork mode');
  }

  // Verify that fork mode is only enabled when NO write access
  if (!content.includes('!hasWriteAccess')) {
    throw new Error('Fork mode should only be enabled when user has no write access');
  }
});

// Test 10: Verify owner detection is inside the argv.fork block
runTest('owner detection is inside argv.fork block', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  // Find the argv.fork block
  const forkBlockStart = content.indexOf('if (argv.fork)');
  if (forkBlockStart === -1) {
    throw new Error('argv.fork check not found');
  }

  // Find the owner check
  const ownerCheckIndex = content.indexOf('currentUser === owner');
  if (ownerCheckIndex === -1) {
    throw new Error('Owner detection check not found');
  }

  // Owner check should be after argv.fork but before the fork creation logic
  if (ownerCheckIndex < forkBlockStart) {
    throw new Error('Owner detection should be inside the argv.fork block');
  }
});

// Summary
console.log('\n' + '='.repeat(50));
console.log('Test Results for owner fork detection (Issue #1206):');
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(50));

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);
