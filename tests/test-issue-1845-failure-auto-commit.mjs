#!/usr/bin/env node
// Test file for issue #1845 (requirement R2): preserve uncommitted work on all
// failures by default. Issue #2263 tightened that contract: preservation must
// happen outside the pull-request branch, never as an unverified solution commit.
//
// The tool-failure chokepoint in solve.mjs already auto-commits, but the EXCEPTION paths
// (uncaught exception, unhandled rejection, and the top-level catch via
// handleMainExecutionError) used to exit WITHOUT preserving the work the agent left on disk.
// handleFailure() in solve.error-handlers.lib.mjs now performs the same guarded snapshot
// at the start, gated by criticalErrorRecovery.autoCommitUncommittedChanges and the presence
// of cleanupContext.tempDir.
//
// These tests drive handleFailure() with a scriptable command-stream `$` double (no real git
// or network) and assert the snapshot happens exactly when it should — and never throws.
//
// Run with: node tests/test-issue-1845-failure-auto-commit.mjs
// @see https://github.com/link-assistant/hive-mind/issues/1845

import assert from 'assert';

const { handleFailure } = await import('../src/solve.error-handlers.lib.mjs');
const { criticalErrorRecovery } = await import('../src/config.lib.mjs');

console.log('Testing failure-path preservation (Issues #1845/#2263)\n');

let passed = 0;
let failed = 0;

const testAsync = async (name, fn) => {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${error.message}`);
    failed++;
  }
};

const noopLog = async () => {};

// Scriptable command-stream `$` double: records every command and returns a dirty/clean
// `git status --porcelain` as configured. Mirrors the pattern used in the #1834 test.
const makeFake$ = (statusOutput = '') => {
  const calls = [];
  const fake = () => async strings => {
    const cmd = strings.join(' ');
    calls.push(cmd);
    if (cmd.includes('git status')) return { code: 0, stdout: statusOutput, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  fake.calls = calls;
  return fake;
};

// Base options that make handleFailure a no-op apart from the auto-commit step:
//  - disableReportIssue → handleErrorWithIssueCreation returns early (no network)
//  - shouldAttachLogs false → no log upload
//  - global without createdPR / autoClosePullRequestOnFail → no PR close
const baseOptions = (fake$, cleanupContext) => ({
  error: new Error('boom: API Error: Output blocked by content filtering policy'),
  errorType: 'execution',
  shouldAttachLogs: false,
  argv: { disableReportIssue: true, noIssueCreation: true },
  global: {},
  owner: null,
  repo: null,
  log: noopLog,
  getLogFile: () => null,
  attachLogToGitHub: async () => false,
  cleanErrorMessage: e => (e && e.message) || String(e),
  sanitizeLogContent: x => x,
  cleanupContext,
  $: fake$,
});

console.log('=== Config sanity ===');
await testAsync('autoCommitUncommittedChanges defaults to true (preserve work on failures)', async () => {
  assert.strictEqual(criticalErrorRecovery.autoCommitUncommittedChanges, true, 'Auto-commit must be ON by default');
});

console.log('\n=== handleFailure preservation behaviour ===');

await testAsync('Snapshots uncommitted work off-branch when cleanupContext.tempDir is set and tree is dirty', async () => {
  const fake$ = makeFake$(' M src/foo.mjs');
  await handleFailure(baseOptions(fake$, { tempDir: '/tmp/none', branchName: 'issue-1845' }));
  assert(
    fake$.calls.some(c => c.includes('git status')),
    'Should inspect the working tree'
  );
  assert(
    fake$.calls.some(c => c.includes('git stash push')),
    'Should snapshot the uncommitted changes'
  );
  assert(
    fake$.calls.some(c => c.includes('git stash apply')),
    'Should restore the preserved working tree'
  );
  assert(!fake$.calls.some(c => c.includes('git commit')), 'Must not commit failed work');
  assert(!fake$.calls.some(c => c.includes('git push')), 'Must not push failed work');
});

await testAsync('Does NOT commit when the working tree is clean', async () => {
  const fake$ = makeFake$('');
  await handleFailure(baseOptions(fake$, { tempDir: '/tmp/none', branchName: 'issue-1845' }));
  assert(
    fake$.calls.some(c => c.includes('git status')),
    'Should still inspect the working tree'
  );
  assert(!fake$.calls.some(c => c.includes('git commit')), 'Must not commit on a clean tree');
});

await testAsync('Skips the auto-commit entirely when cleanupContext is absent', async () => {
  const fake$ = makeFake$(' M src/foo.mjs');
  await handleFailure(baseOptions(fake$, undefined));
  assert(!fake$.calls.some(c => c.includes('git status')), 'No cleanupContext → no git inspection at all');
});

await testAsync('Skips the auto-commit when cleanupContext has no tempDir (nothing checked out yet)', async () => {
  const fake$ = makeFake$(' M src/foo.mjs');
  await handleFailure(baseOptions(fake$, { tempDir: null, branchName: null }));
  assert(!fake$.calls.some(c => c.includes('git status')), 'No tempDir → no git inspection');
});

await testAsync('Never throws even if git commands fail (preservation must not mask the original error)', async () => {
  const throwing$ = () => async () => {
    throw new Error('git exploded');
  };
  // Should resolve (not reject) — handleFailure must swallow preservation failures.
  await handleFailure(baseOptions(throwing$, { tempDir: '/tmp/none', branchName: 'b' }));
});

// ============================================================
// Summary
// ============================================================
console.log('\n' + '='.repeat(50));
console.log(`Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  console.log('\nSome tests failed!');
  process.exit(1);
} else {
  console.log('\nAll tests passed!');
  process.exit(0);
}
