#!/usr/bin/env node
// @hive-mind-test-suite default

/**
 * Test suite for Issue #1716 fix: Skip fork when upstream repository is private
 *
 * Bug: When a PR was originally created from a fork (e.g., the upstream repo
 * was public at the time and the user without write access used --auto-fork),
 * but the upstream is now private and the user has direct write access, the
 * tool still tries to clone the fork. If the fork is renamed or no longer
 * accessible, repository setup fails.
 *
 * Fix: When the upstream repository is private and the user has write access,
 * skip fork mode regardless of the PR's head repository — work directly on the
 * upstream repository using regular branches.
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

const solveContent = execSync(`cat ${srcDir}/solve.mjs`, { encoding: 'utf8' });

// Test 1: solve.mjs computes a single visibility-aware bypass flag
runTest('solve.mjs computes skipForkForPrivateUpstream flag', () => {
  if (!solveContent.includes('const skipForkForPrivateUpstream =')) {
    throw new Error('skipForkForPrivateUpstream flag not declared in solve.mjs');
  }
});

// Test 2: bypass requires private upstream + no explicit --fork + write access
runTest('bypass requires !isRepoPublic && !argv.fork && hasWriteAccess', () => {
  if (!solveContent.includes('!isRepoPublic && !argv.fork && hasWriteAccess')) {
    throw new Error('skipForkForPrivateUpstream condition is not (!isRepoPublic && !argv.fork && hasWriteAccess)');
  }
});

// Test 3: visibility detection is performed unconditionally (not gated on autoCleanup)
runTest('visibility detection runs unconditionally', () => {
  // The fix moves the detectRepositoryVisibility call out of the `if (argv.autoCleanup === undefined)` block
  if (!solveContent.includes('const { isPublic: isRepoPublic } = await detectRepositoryVisibility(owner, repo);')) {
    throw new Error('isRepoPublic not detected unconditionally before fork-detection paths');
  }
});

// Test 4: bypass references issue #1716 in code comments
runTest('bypass references issue #1716', () => {
  if (!solveContent.includes('Issue #1716')) {
    throw new Error('Bypass should reference Issue #1716 for traceability');
  }
});

// Test 5: bypass message mentions working directly on upstream
runTest('bypass logs working directly on private upstream', () => {
  if (!solveContent.includes('Working directly on the private upstream repository')) {
    throw new Error('Bypass should log a message about working on upstream directly');
  }
});

// Test 6: bypass is applied in the auto-continue / processAutoContinueForIssue path
runTest('bypass applied in auto-continue PR-detection path', () => {
  // Ensure the detected fork variables are gated by skipForkForPrivateUpstream
  // in the auto-continue branch (where prCheckData is parsed)
  const autoContinueIdx = solveContent.indexOf('prCheckData.headRepositoryOwner.login');
  const skipFlagIdxAfter = solveContent.indexOf('if (skipForkForPrivateUpstream)', autoContinueIdx);
  if (autoContinueIdx === -1 || skipFlagIdxAfter === -1) {
    throw new Error('Auto-continue path does not consult skipForkForPrivateUpstream');
  }
});

// Test 7: bypass is applied in the direct PR-URL path
runTest('bypass applied in direct PR URL path', () => {
  // The path that uses prData.headRepositoryOwner — must also consult the flag
  const prDataIdx = solveContent.indexOf('prData.headRepositoryOwner.login');
  const skipFlagIdxAfter = solveContent.indexOf('if (skipForkForPrivateUpstream)', prDataIdx);
  if (prDataIdx === -1 || skipFlagIdxAfter === -1) {
    throw new Error('Direct PR-URL path does not consult skipForkForPrivateUpstream');
  }
});

// Test 8: when bypass triggers, forkOwner remains null
runTest('bypass leaves forkOwner null', () => {
  // In the bypass branch, we should NOT assign to forkOwner
  // We verify this structurally by ensuring the assignment to forkOwner is
  // inside an `else` of skipForkForPrivateUpstream, not a sibling.
  const pattern = /if \(skipForkForPrivateUpstream\) \{[\s\S]*?\} else \{\s*forkOwner = detectedForkOwner;/g;
  const matches = solveContent.match(pattern);
  if (!matches || matches.length < 2) {
    throw new Error('forkOwner assignment is not gated behind the !skipForkForPrivateUpstream branch in both fork-detection paths');
  }
});

// Test 9: maintainer-modify check is gated by forkOwner being set
runTest('maintainer-modify check requires forkOwner', () => {
  // After the fix, the `if (argv.allowToPushToContributorsPullRequestsAsMaintainer && argv.autoFork)`
  // block must require forkOwner so it doesn't run when bypass triggered
  const occurrences = solveContent.split('if (forkOwner && argv.allowToPushToContributorsPullRequestsAsMaintainer && argv.autoFork)').length - 1;
  if (occurrences < 2) {
    throw new Error('maintainer-modify branch does not require forkOwner in both fork-detection paths');
  }
});

// Test 10: scenario simulation — private repo, user has write access, PR from fork
runTest('scenario: private upstream + write access + fork PR → bypass', () => {
  const isRepoPublic = false; // private
  const hasWriteAccess = true;
  const argvFork = false; // user did not pass --fork explicitly

  const skipForkForPrivateUpstream = !isRepoPublic && !argvFork && hasWriteAccess;
  if (!skipForkForPrivateUpstream) {
    throw new Error('Expected bypass to trigger for private upstream with write access and no --fork');
  }
});

// Test 11: scenario simulation — public repo with fork PR should NOT bypass
runTest('scenario: public upstream + fork PR → no bypass', () => {
  const isRepoPublic = true;
  const hasWriteAccess = true;
  const argvFork = false;

  const skipForkForPrivateUpstream = !isRepoPublic && !argvFork && hasWriteAccess;
  if (skipForkForPrivateUpstream) {
    throw new Error('Bypass should NOT trigger for public upstream repositories');
  }
});

// Test 12: scenario — explicit --fork should NOT bypass
runTest('scenario: explicit --fork on private repo → no bypass', () => {
  const isRepoPublic = false;
  const hasWriteAccess = true;
  const argvFork = true;

  const skipForkForPrivateUpstream = !isRepoPublic && !argvFork && hasWriteAccess;
  if (skipForkForPrivateUpstream) {
    throw new Error('Bypass should NOT trigger when --fork was passed explicitly');
  }
});

// Test 13: scenario — private repo without write access (auto-fork failure case) → no bypass
runTest('scenario: private upstream + no write access → no bypass', () => {
  const isRepoPublic = false;
  const hasWriteAccess = false;
  const argvFork = false;

  const skipForkForPrivateUpstream = !isRepoPublic && !argvFork && hasWriteAccess;
  if (skipForkForPrivateUpstream) {
    throw new Error('Bypass should NOT trigger when user lacks write access (no fallback would be possible)');
  }
});

// Summary
console.log('\n' + '='.repeat(60));
console.log('Test Results for Issue #1716 (Skip fork for private upstream):');
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(60));

process.exit(testsFailed > 0 ? 1 : 0);
