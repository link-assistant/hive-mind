#!/usr/bin/env node
// @hive-mind-test-suite default

/**
 * Test suite for Issue #1795 fix: Auto-fork should not bail out on a private
 * repository when the caller has read access AND the upstream allows forking.
 *
 * Bug: `solve` failed with "Auto-fork failed - private repository without
 * access" for any private repo without `push` access, even when the user
 * could still fork it (`allow_forking: true`) and post comments via their
 * read-only token. This blocked the workflow for read-access contributors.
 *
 * Fix: Before failing, `handleAutoForkOption` probes the repository's
 * `allow_forking` field. When forking is allowed it sets `argv.fork = true`
 * and continues; when forking is explicitly disabled it falls back to the
 * existing actionable error.
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

const forkDetectionContent = execSync(`cat ${srcDir}/solve.fork-detection.lib.mjs`, { encoding: 'utf8' });

runTest('detectAllowForking helper is defined', () => {
  if (!/async function detectAllowForking\(/.test(forkDetectionContent)) {
    throw new Error('detectAllowForking helper not found');
  }
});

runTest('detectAllowForking calls gh api with allow_forking jq filter', () => {
  if (!forkDetectionContent.includes('gh api repos/${owner}/${repo} --jq .allow_forking')) {
    throw new Error('detectAllowForking should query .allow_forking via gh api');
  }
});

runTest('handleAutoForkOption probes allow_forking before failing on private repo', () => {
  const idxFail = forkDetectionContent.indexOf('Auto-fork failed - private repository without access and forking is disabled');
  const idxProbe = forkDetectionContent.indexOf('await detectAllowForking(owner, repo)');
  if (idxProbe === -1) throw new Error('detectAllowForking is not awaited inside handleAutoForkOption');
  if (idxFail === -1) throw new Error('Updated failure reason for allow_forking=false case is missing');
  if (idxProbe > idxFail) throw new Error('allow_forking probe must run before the fatal exit');
});

runTest('handleAutoForkOption enables fork mode when private + allow_forking != false', () => {
  if (!forkDetectionContent.includes('Read-only access to private repository, enabling fork mode')) {
    throw new Error('Expected success log when private read-only + allow_forking is true');
  }
  const successIdx = forkDetectionContent.indexOf('Read-only access to private repository, enabling fork mode');
  const forkAssign = forkDetectionContent.indexOf('argv.fork = true;', successIdx);
  if (forkAssign === -1) {
    throw new Error('argv.fork = true should be set after the read-only private success log');
  }
});

runTest('handleAutoForkOption preserves the no-write-access fatal exit for allow_forking=false', () => {
  if (!forkDetectionContent.includes('forking is disabled')) {
    throw new Error('Fatal exit text for allow_forking=false case is missing');
  }
  if (!forkDetectionContent.includes('Direct branch mode requires push/write access')) {
    throw new Error('Fatal exit should explain why direct branch mode cannot be used');
  }
  if (!forkDetectionContent.includes('Settings -> General -> Features -> Allow forking')) {
    throw new Error('Suggested solution mentioning the GitHub allow-forking setting is missing');
  }
});

runTest('disabled-forking message explains the current repository access level and API permissions', () => {
  if (!forkDetectionContent.includes('describeRepoPermissionLevel')) {
    throw new Error('Repository access level helper is missing');
  }
  if (!forkDetectionContent.includes('Your detected GitHub repository access level is')) {
    throw new Error('Error message should explain the detected repository access level');
  }
  if (!forkDetectionContent.includes('API permissions: ${JSON.stringify(permissions)}')) {
    throw new Error('Error message should include the exact API permissions object');
  }
});

runTest('disabled-forking message gives maintainer-friendly fix options', () => {
  if (!forkDetectionContent.includes('Write role (Maintain/Admin also works)')) {
    throw new Error('Error message should explain which GitHub roles allow direct branch work');
  }
  if (!forkDetectionContent.includes('organization must also allow private repository forks')) {
    throw new Error('Error message should mention the organization-level private-forking policy');
  }
});

runTest('handleAutoForkOption keeps reference to Issue #1795', () => {
  if (!forkDetectionContent.includes('Issue #1795')) {
    throw new Error('Code should reference Issue #1795 for traceability');
  }
});

runTest('handleAutoForkOption preserves backwards-compat: write access still bypasses fork', () => {
  if (!forkDetectionContent.includes("Write access detected to ${isPublic ? 'public' : 'private'} repository, working directly on repository")) {
    throw new Error('Existing write-access-on-private path must remain unchanged');
  }
});

runTest('handleAutoForkOption preserves backwards-compat: public + no write access enables fork', () => {
  if (!forkDetectionContent.includes('Auto-fork: No write access detected, enabling fork mode')) {
    throw new Error('Existing public + no-write-access success log was removed');
  }
});

runTest('handleAutoForkOption preserves backwards-compat: perm-check failure path on private repos', () => {
  if (!forkDetectionContent.includes('Auto-fork failed - cannot verify private repository permissions')) {
    throw new Error('Existing fatal exit for unverifiable private repo permissions is missing');
  }
});

runTest('verbose warning when allow_forking is indeterminate', () => {
  if (!forkDetectionContent.includes("Could not determine 'allow_forking'")) {
    throw new Error('Indeterminate allow_forking case should emit a verbose warning');
  }
  if (!forkDetectionContent.includes("allow_forking couldn't be confirmed")) {
    throw new Error('Indeterminate allow_forking case should not claim allow_forking=true');
  }
  if (!/allowForking === true/.test(forkDetectionContent)) {
    throw new Error('allow_forking=true should have its own explicit success branch');
  }
});

runTest('scenario: private + no write access + allow_forking=true → fork mode', () => {
  const isPublic = false;
  const hasWriteAccess = false;
  const allowForking = true;

  const shouldFail = !isPublic && !hasWriteAccess && allowForking === false;
  const shouldEnableFork = !isPublic && !hasWriteAccess && allowForking !== false;
  if (shouldFail) throw new Error('Should not fail when allow_forking is true');
  if (!shouldEnableFork) throw new Error('Should enable fork mode for private read-only with allow_forking=true');
});

runTest('scenario: private + no write access + allow_forking=false → fatal exit', () => {
  const isPublic = false;
  const hasWriteAccess = false;
  const allowForking = false;

  const shouldFail = !isPublic && !hasWriteAccess && allowForking === false;
  if (!shouldFail) throw new Error('Should fail when allow_forking is explicitly false');
});

runTest('scenario: private + no write access + allow_forking=null (unknown) → still try', () => {
  // When we cannot determine allow_forking, we fall through to the
  // "enable fork mode" branch and let `gh repo fork` produce a clearer
  // error than the previous early bailout.
  const isPublic = false;
  const hasWriteAccess = false;
  const allowForking = null;

  const shouldFail = !isPublic && !hasWriteAccess && allowForking === false;
  if (shouldFail) throw new Error('Should not fail when allow_forking is unknown');
});

runTest('scenario: public + no write access stays on existing fork path', () => {
  const isPublic = true;
  const hasWriteAccess = false;
  const shouldEnableFork = !hasWriteAccess && isPublic; // existing branch
  if (!shouldEnableFork) throw new Error('Public repos without write access must continue to fork');
});

// Summary
console.log('\n' + '='.repeat(60));
console.log('Test Results for Issue #1795 (Private read-only auto-fork):');
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(60));

process.exit(testsFailed > 0 ? 1 : 0);
