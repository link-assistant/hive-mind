#!/usr/bin/env node

/**
 * Test suite for Issue #1332 fix: Fork name constructed from PR head repository data
 *
 * Bug: When solve.mjs is invoked with a PR from a fork where the fork's repo name
 * differs from the base repo's name, the tool incorrectly builds the fork name
 * using the base repo name instead of the head repo name.
 *
 * Fix: forkRepoName (from headRepository.name) is now passed through the call
 * chain from solve.mjs → setupRepositoryAndClone → setupRepository, and used
 * in solve.repository.lib.mjs to build the correct fork name.
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

// Test 1: solve.mjs declares forkRepoName at outer scope
runTest('solve.mjs declares forkRepoName at outer scope', () => {
  const content = execSync(`cat ${srcDir}/solve.mjs`, { encoding: 'utf8' });

  if (!content.includes('let forkRepoName = null;')) {
    throw new Error('forkRepoName not declared at outer scope in solve.mjs');
  }
});

// Test 2: solve.mjs stores forkRepoName from headRepository.name in auto-continue path
runTest('solve.mjs stores forkRepoName from headRepository in auto-continue path', () => {
  const content = execSync(`cat ${srcDir}/solve.mjs`, { encoding: 'utf8' });

  // Check for the assignment (not declaration with const)
  if (!content.includes('forkRepoName = prCheckData.headRepository && prCheckData.headRepository.name ? prCheckData.headRepository.name : null;')) {
    throw new Error('forkRepoName not stored from prCheckData.headRepository.name in auto-continue path');
  }
});

// Test 3: solve.mjs stores forkRepoName from headRepository.name in PR URL path
runTest('solve.mjs stores forkRepoName from headRepository in PR URL path', () => {
  const content = execSync(`cat ${srcDir}/solve.mjs`, { encoding: 'utf8' });

  if (!content.includes('forkRepoName = prData.headRepository && prData.headRepository.name ? prData.headRepository.name : null;')) {
    throw new Error('forkRepoName not stored from prData.headRepository.name in PR URL path');
  }
});

// Test 4: solve.mjs passes forkRepoName to setupRepositoryAndClone
runTest('solve.mjs passes forkRepoName to setupRepositoryAndClone', () => {
  const content = execSync(`cat ${srcDir}/solve.mjs`, { encoding: 'utf8' });

  if (!content.includes('forkRepoName,')) {
    throw new Error('forkRepoName not passed to setupRepositoryAndClone');
  }

  // Verify it appears in the setupRepositoryAndClone call context
  const setupCallMatch = content.match(/setupRepositoryAndClone\(\{[\s\S]*?forkRepoName[\s\S]*?\}\)/);
  if (!setupCallMatch) {
    throw new Error('forkRepoName not found in setupRepositoryAndClone call');
  }
});

// Test 5: solve.repo-setup.lib.mjs accepts forkRepoName parameter
runTest('solve.repo-setup.lib.mjs accepts forkRepoName parameter', () => {
  const content = execSync(`cat ${srcDir}/solve.repo-setup.lib.mjs`, { encoding: 'utf8' });

  if (!content.includes('forkRepoName')) {
    throw new Error('forkRepoName parameter not found in solve.repo-setup.lib.mjs');
  }

  if (!content.match(/setupRepositoryAndClone\(\{[^}]*forkRepoName[^}]*\}\)/s)) {
    throw new Error('forkRepoName not in setupRepositoryAndClone signature');
  }
});

// Test 6: solve.repo-setup.lib.mjs passes forkRepoName to setupRepository
runTest('solve.repo-setup.lib.mjs passes forkRepoName to setupRepository', () => {
  const content = execSync(`cat ${srcDir}/solve.repo-setup.lib.mjs`, { encoding: 'utf8' });

  // setupRepository is called with forkRepoName as last argument
  if (!content.includes('return await setupRepoFn(argv, owner, repo, forkOwner, issueUrl, forkRepoName);')) {
    throw new Error('forkRepoName not passed to setupRepoFn in solve.repo-setup.lib.mjs');
  }
});

// Test 7: solve.repository.lib.mjs accepts forkRepoName parameter in setupRepository signature
runTest('solve.repository.lib.mjs accepts forkRepoName in setupRepository signature', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  if (!content.includes('export const setupRepository = async (argv, owner, repo, forkOwner = null, issueUrl = null, forkRepoName = null) =>')) {
    throw new Error('forkRepoName parameter not in setupRepository signature in solve.repository.lib.mjs');
  }
});

// Test 8: solve.repository.lib.mjs uses forkRepoName (or falls back to repo) for headRepoName
runTest('solve.repository.lib.mjs uses forkRepoName for headRepoName with fallback', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  if (!content.includes('const headRepoName = forkRepoName || repo;')) {
    throw new Error('headRepoName not computed from forkRepoName with repo fallback');
  }
});

// Test 9: solve.repository.lib.mjs builds fork names using headRepoName (not repo directly)
runTest('solve.repository.lib.mjs builds fork names using headRepoName', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  // In the forkOwner path, standardForkName should use headRepoName
  if (!content.includes('const standardForkName = `${forkOwner}/${headRepoName}`;')) {
    throw new Error('standardForkName does not use headRepoName');
  }

  if (!content.includes('const prefixedForkName = `${forkOwner}/${owner}-${headRepoName}`;')) {
    throw new Error('prefixedForkName does not use headRepoName');
  }
});

// Test 10: Error message now says "Fork tried:" instead of "Fork:"
runTest('improved error message says "Fork tried:"', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  if (!content.includes("'Fork tried:', expectedForkName")) {
    throw new Error('Error message should show "Fork tried:" with the attempted fork name');
  }
});

// Test 11: Error message mentions when fork name was guessed
runTest('error message mentions when fork name was guessed from base repo', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  if (!content.includes('Fork name was guessed from base repo name')) {
    throw new Error('Error message should explain when fork name was guessed from base repo');
  }
});

// Test 12: Error message improved suggestion
runTest('improved error suggestion mentions repo name mismatch', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  if (!content.includes("The fork's repo name may differ from the base repo name")) {
    throw new Error("Error suggestion should mention that fork's repo name may differ from base repo name");
  }
});

// Test 13: Reproduce the exact issue #1332 scenario in code structure
runTest('issue #1332 scenario: forkRepoName prevents wrong name construction', () => {
  // Simulate the scenario:
  // owner = 'konard', repo = 'MILANA808-Milana-backend' (base, which is a fork itself)
  // forkOwner = 'MILANA808', forkRepoName = 'Milana-backend' (from headRepository.name)
  //
  // Old behavior (broken):
  //   standardForkName = MILANA808/MILANA808-Milana-backend  ← WRONG (repo used directly)
  //
  // New behavior (fixed):
  //   headRepoName = forkRepoName || repo = 'Milana-backend'
  //   standardForkName = MILANA808/Milana-backend  ← CORRECT

  const owner = 'konard';
  const repo = 'MILANA808-Milana-backend';
  const forkOwner = 'MILANA808';
  const forkRepoName = 'Milana-backend'; // from headRepository.name

  // Simulate new behavior
  const headRepoName = forkRepoName || repo;
  const standardForkName = `${forkOwner}/${headRepoName}`;
  const prefixedForkName = `${forkOwner}/${owner}-${headRepoName}`;

  if (standardForkName !== 'MILANA808/Milana-backend') {
    throw new Error(`Expected MILANA808/Milana-backend, got ${standardForkName}`);
  }

  if (prefixedForkName !== 'MILANA808/konard-Milana-backend') {
    throw new Error(`Expected MILANA808/konard-Milana-backend, got ${prefixedForkName}`);
  }

  // Verify old behavior would have been wrong
  const oldStandardForkName = `${forkOwner}/${repo}`;
  if (oldStandardForkName === 'MILANA808/Milana-backend') {
    throw new Error('Old behavior would have been correct - test assumption invalid');
  }
  if (oldStandardForkName !== 'MILANA808/MILANA808-Milana-backend') {
    throw new Error(`Old behavior produced unexpected result: ${oldStandardForkName}`);
  }
});

// Test 14: Fallback behavior when forkRepoName is null
runTest('fallback to repo when forkRepoName is null', () => {
  const owner = 'someowner';
  const repo = 'some-repo';
  const forkOwner = 'contributor';
  const forkRepoName = null; // not available from headRepository.name

  const headRepoName = forkRepoName || repo;
  const standardForkName = `${forkOwner}/${headRepoName}`;

  if (standardForkName !== 'contributor/some-repo') {
    throw new Error(`Fallback should use repo name: expected contributor/some-repo, got ${standardForkName}`);
  }
});

// Summary
console.log('\n' + '='.repeat(60));
console.log('Test Results for Issue #1332 (Fork name from PR data):');
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(60));

process.exit(testsFailed > 0 ? 1 : 0);
