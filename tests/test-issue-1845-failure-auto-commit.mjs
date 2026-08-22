#!/usr/bin/env node
// Test file for issue #1845 (requirement R2): "On all failures we automatically commit
// uncommitted changes by default."
//
// The tool-failure chokepoint in solve.mjs already auto-commits, but the EXCEPTION paths
// (uncaught exception, unhandled rejection, and the top-level catch via
// handleMainExecutionError) used to exit WITHOUT preserving the work the agent left on disk.
// handleFailure() in solve.error-handlers.lib.mjs now performs the same guarded auto-commit
// at the start, gated by criticalErrorRecovery.autoCommitUncommittedChanges and the presence
// of cleanupContext.tempDir.
//
// These tests drive handleFailure() with a scriptable command-stream `$` double (no real git
// or network) and assert the commit happens exactly when it should — and never throws.
//
// Run with: node tests/test-issue-1845-failure-auto-commit.mjs
// @see https://github.com/link-assistant/hive-mind/issues/1845

import assert from 'assert';

const { handleFailure } = await import('../src/solve.error-handlers.lib.mjs');
const { criticalErrorRecovery } = await import('../src/config.lib.mjs');

console.log('Testing failure-path auto-commit (Issue #1845, R2)\n');

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

console.log('\n=== handleFailure auto-commit behaviour ===');

await testAsync('Commits and pushes uncommitted work when cleanupContext.tempDir is set and tree is dirty', async () => {
  const fake$ = makeFake$(' M src/foo.mjs');
  await handleFailure(baseOptions(fake$, { tempDir: '/tmp/none', branchName: 'issue-1845' }));
  assert(
    fake$.calls.some(c => c.includes('git status')),
    'Should inspect the working tree'
  );
  assert(
    fake$.calls.some(c => c.includes('git add')),
    'Should stage the uncommitted changes'
  );
  assert(
    fake$.calls.some(c => c.includes('git commit')),
    'Should commit the preserved work'
  );
  assert(
    fake$.calls.some(c => c.includes('git push')),
    'Should push the preserved work to the branch'
  );
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

await testAsync('Never throws even if git commands fail (auto-commit must not mask the original error)', async () => {
  const throwing$ = () => async () => {
    throw new Error('git exploded');
  };
  // Should resolve (not reject) — handleFailure must swallow auto-commit failures.
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
