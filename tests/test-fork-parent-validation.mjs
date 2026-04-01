#!/usr/bin/env node

/**
 * Test suite for fork parent validation (Issue #967)
 *
 * Tests the validateForkParent function that prevents issues where a fork
 * was created from an intermediate fork instead of directly from the
 * intended upstream repository.
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

async function runAsyncTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    await testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

// Test 1: Check that validateForkParent is exported
runTest('validateForkParent export', () => {
  const output = execSync(`grep -l "export const validateForkParent" ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });
  if (!output.includes('solve.repository.lib.mjs')) {
    throw new Error('validateForkParent not exported');
  }
});

// Test 2: Check function signature and JSDoc
runTest('validateForkParent documentation', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  // Check for JSDoc
  if (!content.includes("* Validate that a fork's parent matches the expected upstream repository")) {
    throw new Error('Missing JSDoc description');
  }

  // Check for proper parameter documentation
  if (!content.includes('@param {string} forkRepo')) {
    throw new Error('Missing forkRepo parameter documentation');
  }

  if (!content.includes('@param {string} expectedUpstream')) {
    throw new Error('Missing expectedUpstream parameter documentation');
  }

  // Check for return type documentation
  if (!content.includes('@returns {Promise<{isValid: boolean')) {
    throw new Error('Missing return type documentation');
  }
});

// Test 3: Verify validation is called when existing fork is found
runTest('validation called for existing forks', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  // Check that validateForkParent is called after fork is found
  if (!content.includes('const forkValidation = await validateForkParent(existingForkName')) {
    throw new Error('validateForkParent not called for existing forks');
  }

  // Check that validation result is checked
  if (!content.includes('if (!forkValidation.isValid)')) {
    throw new Error('Validation result not checked');
  }
});

// Test 4: Verify error message mentions issue #967
runTest('error message references issue #967', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  if (!content.includes('issue #967')) {
    throw new Error('Error message should reference issue #967 for context');
  }
});

// Test 5: Verify auto-recovery for non-fork repositories (Issue #1518)
runTest('auto-recovery for non-fork/mismatch repos (Issue #1518)', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  // Check for auto-recovery logic
  if (!content.includes('Auto-recovery:')) {
    throw new Error('Missing auto-recovery logic for non-fork repos');
  }

  // Check for delete operation
  if (!content.includes('gh repo delete ${existingForkName} --yes')) {
    throw new Error('Missing repo deletion in auto-recovery');
  }

  // Check for fallback when delete fails
  if (!content.includes('Manual fix required:')) {
    throw new Error('Missing manual fix fallback when auto-recovery fails');
  }

  // Check existingForkName is cleared after deletion to trigger fork creation
  if (!content.includes('existingForkName = null')) {
    throw new Error('existingForkName should be cleared after deletion to trigger fresh fork creation');
  }
});

// Test 6: Verify function handles API errors gracefully
runTest('API error handling', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  // Check for try-catch block
  if (!content.includes('} catch (error) {') || !content.includes('validate_fork_parent')) {
    throw new Error('Missing error handling in validateForkParent');
  }

  // Check that reportError is called
  if (!content.includes("context: 'validate_fork_parent'")) {
    throw new Error('reportError not called for validation errors');
  }
});

// Test 7: Verify parent vs source distinction
runTest('parent vs source distinction', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  // Check that both parent and source are extracted
  if (!content.includes('const parent = forkInfo.parent')) {
    throw new Error('Fork parent not extracted');
  }

  if (!content.includes('const source = forkInfo.source')) {
    throw new Error('Fork source not extracted');
  }

  // Check for intermediate fork detection (source matches but parent doesn't)
  if (!content.includes('sourceMatches && !parentMatches')) {
    throw new Error('Intermediate fork detection not implemented');
  }
});

// Test 8: Verify validation also happens for forkOwner path
runTest('validation for forkOwner code path', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  // Count occurrences of validateForkParent being called
  const matches = content.match(/await validateForkParent\(/g);
  if (!matches || matches.length < 2) {
    throw new Error('validateForkParent should be called in both existing fork and forkOwner paths');
  }
});

// Test 9: Verify non-fork detection
runTest('non-fork repository detection', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  // Check for isFork field in return
  if (!content.includes('isFork: false')) {
    throw new Error('Should handle case when repository is not a fork');
  }

  // Check for descriptive error message
  if (!content.includes('is not a GitHub fork')) {
    throw new Error('Should provide clear message when repository is not a fork');
  }
});

// Test 10: Verify success message when validation passes
runTest('success message on valid fork', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  if (!content.includes("'Fork parent validated:'")) {
    throw new Error('Should log success message when fork parent is valid');
  }
});

// Test 11: Verify retry logic for transient network errors (Issue #1311)
runTest('retry logic for network errors (Issue #1311)', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  // Check for retry loop implementation
  if (!content.includes('for (let attempt = 1; attempt <= maxAttempts; attempt++)')) {
    throw new Error('Missing retry loop in validateForkParent');
  }

  // Check for exponential backoff
  if (!content.includes('baseDelay * Math.pow(2, attempt - 1)')) {
    throw new Error('Missing exponential backoff in retry logic');
  }

  // Check for network error detection call
  if (!content.includes('lib.isTransientNetworkError')) {
    throw new Error('Missing network error detection using lib.isTransientNetworkError');
  }
});

// Test 12: Verify isNetworkError flag in return value (Issue #1311)
runTest('isNetworkError flag in return value (Issue #1311)', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  // Check for isNetworkError field in return
  if (!content.includes('isNetworkError: true')) {
    throw new Error('Missing isNetworkError flag in return value for network errors');
  }

  // Check that JSDoc mentions the new field
  if (!content.includes('isNetworkError?:')) {
    throw new Error('Missing isNetworkError field in JSDoc return type');
  }
});

// Test 13: Verify separate error message for network errors (Issue #1311)
runTest('network error message differentiation (Issue #1311)', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  // Check for network-specific error title
  if (!content.includes('NETWORK ERROR DURING FORK VALIDATION')) {
    throw new Error('Missing network-specific error message');
  }

  // Check for network retry/temporary suggestion
  if (!content.includes('temporary network issue')) {
    throw new Error('Missing temporary network issue message');
  }

  // Check for GitHub status link
  if (!content.includes('githubstatus.com')) {
    throw new Error('Missing GitHub status link in network error message');
  }
});

// Test 14: Verify isTransientNetworkError helper exists in lib.mjs
runTest('isTransientNetworkError helper exists', () => {
  const libContent = execSync(`cat ${srcDir}/lib.mjs`, { encoding: 'utf8' });

  // Check for function definition
  if (!libContent.includes('export const isTransientNetworkError')) {
    throw new Error('Missing isTransientNetworkError export in lib.mjs');
  }

  // Check for key network error patterns
  const patterns = ['i/o timeout', 'dial tcp', 'econnreset', 'etimedout', 'http 503'];
  for (const pattern of patterns) {
    if (!libContent.includes(pattern)) {
      throw new Error(`Missing network error pattern: ${pattern}`);
    }
  }
});

// Test 15: Verify error context preserved in auto-recovery messages (Issue #1518)
runTest('error context in auto-recovery messages', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  // Check that issue references are preserved
  if (!content.includes('see issue #1518')) {
    throw new Error('Missing issue #1518 reference for non-fork repos');
  }

  if (!content.includes('see issue #967')) {
    throw new Error('Missing issue #967 reference for intermediate forks');
  }

  // Check that fork relationship details are logged
  if (!content.includes('Fork parent:')) {
    throw new Error('Missing fork parent details in log output');
  }

  // Check for network error handling
  if (!content.includes('🔍 What happened:')) {
    throw new Error('Missing "What happened" section in network error message');
  }
});

// Test 16: Verify post-creation fork validation (Issue #1518)
runTest('post-creation fork validation (Issue #1518)', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  // Check that validateForkParent is called after fork creation
  if (!content.includes('postCreateValidation')) {
    throw new Error('Missing post-creation fork validation');
  }

  // Check for Sentry error reporting on post-creation validation failure
  if (!content.includes("context: 'fork_creation_validation'")) {
    throw new Error('Missing Sentry error reporting for post-creation validation failure');
  }

  // Check for gh CLI bug reference
  if (!content.includes('gh CLI bug')) {
    throw new Error('Missing gh CLI bug reference in post-creation warning');
  }
});

// Test 17: Verify verbose fork command logging (Issue #1518)
runTest('verbose fork command logging (Issue #1518)', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  // Check for fork command logging
  if (!content.includes("'Fork command:'")) {
    throw new Error('Missing fork command verbose logging');
  }

  // Check it is behind verbose flag
  if (!content.includes('if (argv.verbose)')) {
    throw new Error('Fork command logging should be behind verbose flag');
  }
});

// Summary
console.log('\n' + '='.repeat(50));
console.log('Test Results for fork parent validation:');
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(50));

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);
