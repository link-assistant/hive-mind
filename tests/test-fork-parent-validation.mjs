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

// Test 5: Verify helpful fix suggestions are provided
runTest('fix suggestions provided', () => {
  const content = execSync(`cat ${srcDir}/solve.repository.lib.mjs`, { encoding: 'utf8' });

  // Check for Option 1: Delete fork
  if (!content.includes('Option 1: Delete the problematic fork')) {
    throw new Error('Missing suggestion to delete fork');
  }

  // Check for Option 2: Prefix fork name
  if (!content.includes('prefix-fork-name-with-owner-name')) {
    throw new Error('Missing suggestion for --prefix-fork-name-with-owner-name');
  }

  // Check for Option 3: No fork
  if (!content.includes('Option 3: Work directly on the repository')) {
    throw new Error('Missing suggestion for --no-fork');
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

// Summary
console.log('\n' + '='.repeat(50));
console.log('Test Results for fork parent validation:');
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(50));

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);
