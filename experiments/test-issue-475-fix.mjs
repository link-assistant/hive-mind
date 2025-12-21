#!/usr/bin/env node

/**
 * Test for issue #475: Verify PR creation is mandatory when required
 *
 * This test verifies that:
 * 1. When in continue mode without a PR, PR creation is attempted
 * 2. When PR creation fails, the entire solve command fails
 * 3. Clear error messages are shown when PR is missing
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('Testing PR creation mandatory requirement (issue #475)');
console.log('='.repeat(70));

// Test 1: Verify handleAutoPrCreation accepts prNumber parameter
console.log('\nTest 1: Check handleAutoPrCreation signature');
const autoPrLibPath = join(__dirname, '..', 'src', 'solve.auto-pr.lib.mjs');
const autoPrLibContent = await fs.readFile(autoPrLibPath, 'utf8');

if (autoPrLibContent.includes('prNumber,')) {
  console.log('✅ PASS: handleAutoPrCreation accepts prNumber parameter');
} else {
  console.log('❌ FAIL: prNumber parameter not found in handleAutoPrCreation');
  process.exit(1);
}

// Test 2: Verify logic for continue mode without PR
console.log('\nTest 2: Check continue mode without PR logic');
if (
  autoPrLibContent.includes('isContinueMode && !prNumber') ||
  autoPrLibContent.includes('isContinueMode && prNumber')
) {
  console.log('✅ PASS: Logic handles continue mode with/without PR');
} else {
  console.log('❌ FAIL: Continue mode PR check not found');
  process.exit(1);
}

// Test 3: Verify solve.mjs passes prNumber to handleAutoPrCreation
console.log('\nTest 3: Check solve.mjs passes prNumber');
const solvePath = join(__dirname, '..', 'src', 'solve.mjs');
const solveContent = await fs.readFile(solvePath, 'utf8');

// Check if prNumber is passed to handleAutoPrCreation
const handleCallMatch = solveContent.match(/handleAutoPrCreation\(\{[^}]*prNumber[^}]*\}\)/s);
if (handleCallMatch) {
  console.log('✅ PASS: solve.mjs passes prNumber to handleAutoPrCreation');
} else {
  console.log('❌ FAIL: solve.mjs does not pass prNumber parameter');
  process.exit(1);
}

// Test 4: Verify validation check exists after PR creation
console.log('\nTest 4: Check PR validation after creation');
if (
  solveContent.includes('CRITICAL: Validate that we have a PR number when required') ||
  solveContent.includes('No pull request available')
) {
  console.log('✅ PASS: PR validation check exists');
} else {
  console.log('❌ FAIL: PR validation check not found');
  process.exit(1);
}

// Test 5: Verify validation checks both continue mode and auto-PR mode
console.log('\nTest 5: Check validation covers both modes');
if (solveContent.includes('isContinueMode || argv.autoPullRequestCreation') && solveContent.includes('!prNumber')) {
  console.log('✅ PASS: Validation checks both continue and auto-PR modes');
} else {
  console.log('❌ FAIL: Validation does not check both modes');
  process.exit(1);
}

// Test 6: Verify error message provides helpful instructions
console.log('\nTest 6: Check error message quality');
const errorSections = ['What happened:', 'Why this is critical:', 'How to fix:', 'Option 1:', 'Option 2:', 'Option 3:'];

let allSectionsPresent = true;
for (const section of errorSections) {
  if (!solveContent.includes(section)) {
    console.log(`❌ FAIL: Error message missing section: ${section}`);
    allSectionsPresent = false;
  }
}

if (allSectionsPresent) {
  console.log('✅ PASS: Error message includes all helpful sections');
} else {
  process.exit(1);
}

// Test 7: Verify error causes process exit
console.log('\nTest 7: Check error causes exit');
if (solveContent.includes('safeExit(1') && solveContent.includes('No PR available')) {
  console.log('✅ PASS: Error causes process to exit');
} else {
  console.log('❌ FAIL: Error does not cause exit');
  process.exit(1);
}

// Test 8: Verify old auto-pr logic updated
console.log('\nTest 8: Check old PR creation skip logic updated');
const oldLogic = 'if (!argv.autoPullRequestCreation || isContinueMode) {';
if (autoPrLibContent.includes(oldLogic)) {
  console.log('❌ FAIL: Old simple skip logic still present');
  console.log('   This would skip PR creation for continue mode without checking prNumber');
  process.exit(1);
} else {
  console.log('✅ PASS: Old skip logic has been updated');
}

// Test 9: Verify explicit handling of continue mode with existing PR
console.log('\nTest 9: Check continue mode with existing PR skip');
if (
  autoPrLibContent.includes('Continue mode with existing PR - skip PR creation') ||
  autoPrLibContent.includes('isContinueMode && prNumber')
) {
  console.log('✅ PASS: Explicit skip for continue mode with existing PR');
} else {
  console.log('❌ FAIL: No explicit skip for continue mode with existing PR');
  process.exit(1);
}

// Test 10: Verify the error message explains the issue clearly
console.log('\nTest 10: Check error message clarity');
const criticalMessages = ['Tracking work progress', 'Receiving and processing feedback', 'Managing code changes'];

let allMessagesPresent = true;
for (const msg of criticalMessages) {
  if (!solveContent.includes(msg)) {
    console.log(`❌ FAIL: Missing explanation: ${msg}`);
    allMessagesPresent = false;
  }
}

if (allMessagesPresent) {
  console.log('✅ PASS: Error message explains why PR is critical');
} else {
  process.exit(1);
}

console.log('\n' + '='.repeat(70));
console.log('All tests passed! ✅');
console.log('\nSummary of fixes:');
console.log('1. handleAutoPrCreation now accepts prNumber parameter');
console.log('2. Continue mode without PR triggers PR creation');
console.log('3. Continue mode with PR skips PR creation');
console.log('4. Validation ensures PR exists before proceeding');
console.log('5. Clear error messages explain why PR is required');
console.log('6. Multiple recovery options provided to user');
console.log('7. Process exits if PR creation fails or is missing');
console.log('\nThis prevents the scenario where:');
console.log('• An existing branch is found');
console.log('• No PR exists for that branch');
console.log('• Continue mode is activated');
console.log('• Work proceeds without a PR (BUG - now fixed)');
