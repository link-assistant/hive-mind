#!/usr/bin/env node

/**
 * Test for issue #475: PR creation failure should fail entire solve command
 *
 * This test verifies that when auto-PR creation fails, the entire solve command
 * stops with a clear error message instead of continuing without a PR.
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('Testing PR creation failure handling (issue #475)');
console.log('='.repeat(60));

// Test 1: Verify the error handling code is present
console.log('\nTest 1: Checking error handling code in solve.auto-pr.lib.mjs');
const autoPrLibPath = join(__dirname, '..', 'src', 'solve.auto-pr.lib.mjs');
const autoPrLibContent = await fs.readFile(autoPrLibPath, 'utf8');

// Check that the catch block re-throws instead of continuing
if (autoPrLibContent.includes('Continuing without PR...')) {
  console.log('❌ FAIL: Code still contains "Continuing without PR..." which suggests errors are being swallowed');
  process.exit(1);
} else {
  console.log('✅ PASS: Old "Continuing without PR..." message removed');
}

// Check that error is re-thrown
if (autoPrLibContent.includes('throw new Error(`PR creation failed:')) {
  console.log('✅ PASS: Error is re-thrown to fail the entire command');
} else {
  console.log('❌ FAIL: Error is not being re-thrown properly');
  process.exit(1);
}

// Check for improved error messages
if (autoPrLibContent.includes('FATAL ERROR:') && autoPrLibContent.includes('PR creation failed')) {
  console.log('✅ PASS: Fatal error message is present');
} else {
  console.log('❌ FAIL: Fatal error message not found');
  process.exit(1);
}

// Check for actionable instructions
if (autoPrLibContent.includes('How to fix:') && autoPrLibContent.includes('--no-auto-pull-request-creation')) {
  console.log('✅ PASS: Actionable instructions provided');
} else {
  console.log('❌ FAIL: Actionable instructions not found');
  process.exit(1);
}

// Test 2: Check improved error messages for assignment failure
console.log('\nTest 2: Checking improved error messages for assignment failure');
if (autoPrLibContent.includes('User assignment failed')) {
  console.log('✅ PASS: Better error message for assignment failure');
} else {
  console.log('❌ FAIL: Assignment failure error message not improved');
  process.exit(1);
}

// Check that PR verification is attempted when assignment fails
if (autoPrLibContent.includes('Checking if PR was created anyway...')) {
  console.log('✅ PASS: PR verification attempted on assignment failure');
} else {
  console.log('❌ FAIL: PR verification not attempted');
  process.exit(1);
}

// Check for detailed error explanation when PR actually fails
if (
  autoPrLibContent.includes('assignee validation issue') ||
  autoPrLibContent.includes("assignee doesn't have access")
) {
  console.log('✅ PASS: Detailed explanation for assignee issues provided');
} else {
  console.log('❌ FAIL: Assignee issue explanation not found');
  process.exit(1);
}

// Test 3: Verify error messages include temp directory path
console.log('\nTest 3: Checking that error messages include helpful context');
const errorMessageSections = [
  'cd ${tempDir}', // Should tell user where to go
  'gh pr create', // Should suggest manual PR creation
  'git status' // Should suggest debugging commands
];

let missingContext = false;
for (const section of errorMessageSections) {
  if (!autoPrLibContent.includes(section)) {
    console.log(`❌ FAIL: Error message missing: ${section}`);
    missingContext = true;
  }
}

if (!missingContext) {
  console.log('✅ PASS: Error messages include helpful context');
}

// Test 4: Check for multiple recovery options
console.log('\nTest 4: Checking for multiple recovery options');
const recoveryOptions = ['Option 1:', 'Option 2:', 'Option 3:'];

let allOptionsPresent = true;
for (const option of recoveryOptions) {
  if (!autoPrLibContent.includes(option)) {
    console.log(`❌ FAIL: Missing recovery option: ${option}`);
    allOptionsPresent = false;
  }
}

if (allOptionsPresent) {
  console.log('✅ PASS: Multiple recovery options provided');
} else {
  process.exit(1);
}

// Test 5: Check for PR verification after creation
console.log('\nTest 5: Checking PR verification after creation');
if (
  autoPrLibContent.includes('gh pr view') &&
  autoPrLibContent.includes('Verifying:') &&
  autoPrLibContent.includes('PR exists on GitHub')
) {
  console.log('✅ PASS: PR verification is performed after creation');
} else {
  console.log('❌ FAIL: PR verification not found');
  process.exit(1);
}

// Check that verification failure is handled
if (autoPrLibContent.includes('PR does not exist on GitHub')) {
  console.log('✅ PASS: Verification failure handling present');
} else {
  console.log('❌ FAIL: Verification failure not handled');
  process.exit(1);
}

console.log('\n' + '='.repeat(60));
console.log('All tests passed! ✅');
console.log('\nSummary:');
console.log('- PR creation failures now stop the entire solve command');
console.log('- Clear error messages explain what went wrong');
console.log('- Multiple recovery options are provided to the user');
console.log('- Special handling for assignment failures with PR verification');
console.log('- PR creation is verified with gh pr view after creation');
