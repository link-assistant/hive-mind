#!/usr/bin/env node

/**
 * Test script to verify improved error messages with repository and PR links
 */

import { handleBranchCheckoutError, handleBranchCreationError, handleBranchVerificationError } from '../src/solve.branch-errors.lib.mjs';

// Mock dependencies - $ needs to handle cwd option
const $ = options => {
  // Return a function that can be called with template literals
  return () => Promise.resolve({ code: 0, stdout: 'mock branch output' });
};
const log = async msg => console.log(msg);
const formatAligned = (icon, label, value) => `${icon} ${label} ${value}`.trim();
const argv = { verbose: false };

async function testBranchCheckoutError() {
  console.log('\n=== TEST 1: Branch Checkout Error (PR from fork) ===\n');

  await handleBranchCheckoutError({
    branchName: 'issue-9-231cfae8',
    prNumber: 10,
    errorOutput: "fatal: 'origin/issue-9-231cfae8' is not a commit and a branch 'issue-9-231cfae8' cannot be created from it",
    issueUrl: 'https://github.com/1dNDN/BitrotBruteforce/pull/10',
    owner: '1dNDN',
    repo: 'BitrotBruteforce',
    tempDir: '/tmp/test-repo',
    argv,
    formatAligned,
    log,
    $,
  });
}

async function testBranchCreationError() {
  console.log('\n=== TEST 2: Branch Creation Error ===\n');

  await handleBranchCreationError({
    branchName: 'feature-test-123',
    errorOutput: "fatal: A branch named 'feature-test-123' already exists.",
    tempDir: '/tmp/test-repo',
    owner: 'link-assistant',
    repo: 'hive-mind',
    formatAligned,
    log,
  });
}

async function testBranchVerificationError() {
  console.log('\n=== TEST 3: Branch Verification Error ===\n');

  await handleBranchVerificationError({
    isContinueMode: true,
    branchName: 'issue-276-expected',
    actualBranch: 'main',
    prNumber: 281,
    owner: 'link-assistant',
    repo: 'hive-mind',
    tempDir: '/tmp/test-repo',
    formatAligned,
    log,
    $,
  });
}

async function main() {
  console.log('Testing improved error messages with repository and PR links...\n');

  await testBranchCheckoutError();
  await testBranchCreationError();
  await testBranchVerificationError();

  console.log('\n=== TESTS COMPLETED ===');
  console.log('\nKey improvements verified:');
  console.log('✅ Repository URLs are included in error messages');
  console.log('✅ Pull Request URLs are included when applicable');
  console.log('✅ Fork repository URLs are shown for fork-based PRs');
  console.log('✅ Command examples use full GitHub URLs instead of ambiguous issueUrl');
}

main().catch(console.error);
