#!/usr/bin/env node

/**
 * Test suite for --auto-init-repository feature (issue #1230)
 * Tests empty repository detection, option registration, and error message improvements
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

console.log('🧪 Auto-Init Repository Tests (Issue #1230)\n');

// =============================================
// Test 1: Option is defined in solve.config.lib.mjs
// =============================================
runTest('--auto-init-repository option is defined in SOLVE_OPTION_DEFINITIONS', () => {
  const configContent = readFileSync(join(srcDir, 'solve.config.lib.mjs'), 'utf-8');
  assert(configContent.includes("'auto-init-repository'"), 'auto-init-repository should be defined in SOLVE_OPTION_DEFINITIONS');
  assert(configContent.includes("type: 'boolean'"), 'Should be a boolean option');
  assert(configContent.includes('Automatically initialize empty repositories'), 'Should have descriptive help text');
  assert(configContent.includes('default: false'), 'Should default to false');
});

// =============================================
// Test 2: Option is in KNOWN_OPTION_NAMES for typo detection
// =============================================
runTest('--auto-init-repository is in KNOWN_OPTION_NAMES', () => {
  const suggestionsContent = readFileSync(join(srcDir, 'option-suggestions.lib.mjs'), 'utf-8');
  assert(suggestionsContent.includes("'auto-init-repository'"), 'auto-init-repository should be in KNOWN_OPTION_NAMES for malformed flag detection');
});

// =============================================
// Test 3: tryInitializeEmptyRepository is exported
// =============================================
runTest('tryInitializeEmptyRepository is exported from solve.repository.lib.mjs', () => {
  const repoContent = readFileSync(join(srcDir, 'solve.repository.lib.mjs'), 'utf-8');
  assert(repoContent.includes('export const tryInitializeEmptyRepository'), 'tryInitializeEmptyRepository should be exported (not just a const)');
});

// =============================================
// Test 4: verifyDefaultBranchAndStatus accepts new parameters including issueUrl
// =============================================
runTest('verifyDefaultBranchAndStatus accepts argv, owner, repo, issueUrl parameters', () => {
  const repoSetupContent = readFileSync(join(srcDir, 'solve.repo-setup.lib.mjs'), 'utf-8');
  assert(repoSetupContent.includes('argv, owner, repo, issueUrl'), 'verifyDefaultBranchAndStatus should accept argv, owner, repo, issueUrl parameters');
});

// =============================================
// Test 5: Empty repo detection function exists
// =============================================
runTest('detectEmptyRepository function is implemented', () => {
  const repoSetupContent = readFileSync(join(srcDir, 'solve.repo-setup.lib.mjs'), 'utf-8');
  assert(repoSetupContent.includes('async function detectEmptyRepository'), 'detectEmptyRepository helper function should exist');
  assert(repoSetupContent.includes('git rev-parse HEAD'), 'Should check for HEAD existence to detect empty repos');
  assert(repoSetupContent.includes('git branch -r'), 'Should check for remote branches as additional empty repo detection');
});

// =============================================
// Test 6: Auto-init flow is implemented
// =============================================
runTest('Auto-init flow handles enabled --auto-init-repository', () => {
  const repoSetupContent = readFileSync(join(srcDir, 'solve.repo-setup.lib.mjs'), 'utf-8');
  assert(repoSetupContent.includes('argv.autoInitRepository'), 'Should check argv.autoInitRepository (camelCase from yargs)');
  assert(repoSetupContent.includes('tryInitializeEmptyRepository'), 'Should call tryInitializeEmptyRepository when auto-init is enabled');
  assert(repoSetupContent.includes('git fetch origin'), 'Should re-fetch origin after initialization');
  assert(repoSetupContent.includes('git remote show origin'), 'Should determine default branch from remote after init');
});

// =============================================
// Test 7: Error message suggests --auto-init-repository when disabled
// =============================================
runTest('Error message suggests --auto-init-repository when empty repo detected without flag', () => {
  const repoSetupContent = readFileSync(join(srcDir, 'solve.repo-setup.lib.mjs'), 'utf-8');
  assert(repoSetupContent.includes('EMPTY REPOSITORY DETECTED'), 'Should show clear EMPTY REPOSITORY DETECTED message');
  assert(repoSetupContent.includes('--auto-init-repository flag'), 'Should suggest using --auto-init-repository flag');
  assert(repoSetupContent.includes('solve <issue-url> --auto-init-repository'), 'Should show usage example with --auto-init-repository');
});

// =============================================
// Test 8: Branch creation error handler detects empty repo pattern
// =============================================
runTest('handleBranchCreationError detects "is not a commit" empty repo pattern', () => {
  const branchErrorsContent = readFileSync(join(srcDir, 'solve.branch-errors.lib.mjs'), 'utf-8');
  assert(branchErrorsContent.includes("errorOutput.includes('is not a commit')"), 'Should detect "is not a commit" error pattern');
  assert(branchErrorsContent.includes('--auto-init-repository'), 'Should suggest --auto-init-repository in branch creation error');
  assert(branchErrorsContent.includes('repository appears to be empty'), 'Should identify root cause as empty repository');
});

// =============================================
// Test 9: solve.mjs passes required parameters including issueUrl
// =============================================
runTest('solve.mjs passes argv, owner, repo, issueUrl to verifyDefaultBranchAndStatus', () => {
  const solveContent = readFileSync(join(srcDir, 'solve.mjs'), 'utf-8');
  // Check that the call includes argv, owner, repo, issueUrl
  assert(solveContent.includes('argv,\n    owner,\n    repo,\n    issueUrl,'), 'solve.mjs should pass argv, owner, repo, issueUrl to verifyDefaultBranchAndStatus');
});

// =============================================
// Test 10: Empty repo detection patterns
// =============================================
runTest('detectEmptyRepository checks common git error patterns', () => {
  const repoSetupContent = readFileSync(join(srcDir, 'solve.repo-setup.lib.mjs'), 'utf-8');
  assert(repoSetupContent.includes('unknown revision'), 'Should detect "unknown revision" error pattern');
  assert(repoSetupContent.includes('bad default revision'), 'Should detect "bad default revision" error pattern');
  assert(repoSetupContent.includes('does not have any commits'), 'Should detect "does not have any commits" error pattern');
});

// =============================================
// Test 11: Auto-init failure handling
// =============================================
runTest('Auto-init failure provides actionable guidance', () => {
  const repoSetupContent = readFileSync(join(srcDir, 'solve.repo-setup.lib.mjs'), 'utf-8');
  assert(repoSetupContent.includes('AUTO-INIT FAILED'), 'Should show AUTO-INIT FAILED when initialization fails');
  assert(repoSetupContent.includes('Empty repository auto-initialization failed'), 'Should throw descriptive error on auto-init failure');
});

// =============================================
// Test 12: Case study documentation exists
// =============================================
runTest('Case study documentation created for issue #1230', () => {
  const caseStudyDir = join(__dirname, '..', 'docs', 'case-studies', 'issue-1230');
  const readmeContent = readFileSync(join(caseStudyDir, 'README.md'), 'utf-8');
  assert(readmeContent.includes('Empty Repository Branch Creation Failure'), 'Case study should describe the empty repo branch creation failure');
  assert(readmeContent.includes('Root Cause Analysis'), 'Case study should include root cause analysis');
  assert(readmeContent.includes('--auto-init-repository'), 'Case study should reference the new option');

  // Verify the solve log is saved
  const logContent = readFileSync(join(caseStudyDir, 'solve-log.txt'), 'utf-8');
  assert(logContent.includes('BRANCH CREATION FAILED'), 'Solve log should contain the original error');
});

// =============================================
// Test 13: tryCommentOnIssueAboutEmptyRepo helper function exists
// =============================================
runTest('tryCommentOnIssueAboutEmptyRepo helper function is implemented', () => {
  const repoSetupContent = readFileSync(join(srcDir, 'solve.repo-setup.lib.mjs'), 'utf-8');
  assert(repoSetupContent.includes('async function tryCommentOnIssueAboutEmptyRepo'), 'tryCommentOnIssueAboutEmptyRepo helper should exist');
  assert(repoSetupContent.includes('gh issue comment'), 'Should use gh issue comment to post to the issue');
  assert(repoSetupContent.includes('Repository Initialization Required'), 'Comment body should explain the issue clearly');
  assert(repoSetupContent.includes('--auto-init-repository'), 'Comment should suggest --auto-init-repository flag');
});

// =============================================
// Test 14: Comment is posted when empty repo detected without --auto-init-repository flag
// =============================================
runTest('Issue comment is posted when empty repo detected without --auto-init-repository', () => {
  const repoSetupContent = readFileSync(join(srcDir, 'solve.repo-setup.lib.mjs'), 'utf-8');
  // Find the "else if (isEmptyRepo)" block and verify it calls tryCommentOnIssueAboutEmptyRepo
  const emptyRepoBlock = repoSetupContent.indexOf('EMPTY REPOSITORY DETECTED');
  const throwAfterBlock = repoSetupContent.indexOf("throw new Error('Empty repository detected - use --auto-init-repository to initialize');");
  assert(emptyRepoBlock !== -1, 'Should have EMPTY REPOSITORY DETECTED block');
  assert(throwAfterBlock !== -1, 'Should throw error after empty repo detection');
  const blockContent = repoSetupContent.substring(emptyRepoBlock, throwAfterBlock);
  assert(blockContent.includes('tryCommentOnIssueAboutEmptyRepo'), 'Should call tryCommentOnIssueAboutEmptyRepo before throwing');
});

// =============================================
// Test 15: Comment is posted when auto-init fails
// =============================================
runTest('Issue comment is posted when auto-init fails', () => {
  const repoSetupContent = readFileSync(join(srcDir, 'solve.repo-setup.lib.mjs'), 'utf-8');
  // Find the "AUTO-INIT FAILED" block and verify it calls tryCommentOnIssueAboutEmptyRepo
  const autoInitFailedBlock = repoSetupContent.indexOf('AUTO-INIT FAILED');
  const throwAfterBlock = repoSetupContent.indexOf("throw new Error('Empty repository auto-initialization failed');");
  assert(autoInitFailedBlock !== -1, 'Should have AUTO-INIT FAILED block');
  assert(throwAfterBlock !== -1, 'Should throw error after auto-init failure');
  const blockContent = repoSetupContent.substring(autoInitFailedBlock, throwAfterBlock);
  assert(blockContent.includes('tryCommentOnIssueAboutEmptyRepo'), 'Should call tryCommentOnIssueAboutEmptyRepo before throwing');
});

// =============================================
// Test 16: No comment posted when auto-init succeeds
// =============================================
runTest('No issue comment is posted when auto-init succeeds', () => {
  const repoSetupContent = readFileSync(join(srcDir, 'solve.repo-setup.lib.mjs'), 'utf-8');
  // Find the success path (between 'initialized' check and the 'else' for auto-init failure)
  const successStart = repoSetupContent.indexOf("await log(`${formatAligned('✅', 'Repository initialized:'");
  const successEnd = repoSetupContent.indexOf('AUTO-INIT FAILED');
  assert(successStart !== -1, 'Should have Repository initialized success message');
  assert(successEnd !== -1, 'Should have AUTO-INIT FAILED block');
  const successBlock = repoSetupContent.substring(successStart, successEnd);
  assert(!successBlock.includes('tryCommentOnIssueAboutEmptyRepo'), 'Success path should NOT call tryCommentOnIssueAboutEmptyRepo');
});

// =============================================
// Test 17: Comment function handles missing issueUrl gracefully
// =============================================
runTest('tryCommentOnIssueAboutEmptyRepo handles missing issueUrl gracefully', () => {
  const repoSetupContent = readFileSync(join(srcDir, 'solve.repo-setup.lib.mjs'), 'utf-8');
  // Find the function definition
  const funcStart = repoSetupContent.indexOf('async function tryCommentOnIssueAboutEmptyRepo');
  assert(funcStart !== -1, 'Function should exist');
  const funcBlock = repoSetupContent.substring(funcStart, funcStart + 500);
  assert(funcBlock.includes('if (!issueUrl) return'), 'Should return early if issueUrl is not provided');
  assert(funcBlock.includes('issueUrl.match(/\\/issues\\/(\\d+)/)'), 'Should extract issue number from URL');
});

// =============================================
// Summary
// =============================================
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${testsPassed} passed, ${testsFailed} failed`);
console.log(`${'='.repeat(50)}`);

if (testsFailed > 0) {
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
}
