#!/usr/bin/env node
/**
 * Auto-merge permissions and fork-mode guard tests
 *
 * Tests for the checkMergePermissions function and fork-mode detection
 * in the auto-merge pipeline (Issue #1226).
 *
 * Run with: node tests/test-auto-merge-permissions.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1226
 */

import assert from 'node:assert/strict';
import { checkMergePermissions } from '../src/github-merge.lib.mjs';

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

// ============================================================================
// checkMergePermissions function tests
// ============================================================================

console.log('\n📋 checkMergePermissions Function Tests\n');

test('checkMergePermissions is exported and is a function', () => {
  assert.equal(typeof checkMergePermissions, 'function', 'checkMergePermissions should be a function');
});

test('checkMergePermissions returns correct structure', async () => {
  // This test verifies the function returns the expected shape even if the API call fails
  const result = await checkMergePermissions('nonexistent-owner-12345', 'nonexistent-repo-12345', false);
  assert.ok(result !== null && result !== undefined, 'Result should not be null/undefined');
  assert.ok('canMerge' in result, 'Result should have canMerge property');
  assert.ok('permission' in result, 'Result should have permission property');
});

await asyncTest('checkMergePermissions returns false for nonexistent repo', async () => {
  const result = await checkMergePermissions('nonexistent-owner-12345', 'nonexistent-repo-12345', false);
  assert.equal(result.canMerge, false, 'Should return canMerge=false for nonexistent repo');
  assert.equal(result.permission, null, 'Should return permission=null for nonexistent repo');
});

await asyncTest('checkMergePermissions returns correct result for link-assistant/hive-mind', async () => {
  // We should have access to our own repo
  const result = await checkMergePermissions('link-assistant', 'hive-mind', false);
  assert.ok(result !== null, 'Result should not be null');
  assert.ok(typeof result.canMerge === 'boolean', 'canMerge should be a boolean');
  if (result.permission !== null) {
    assert.ok(['admin', 'maintain', 'push', 'read'].includes(result.permission), `permission should be one of admin/maintain/push/read, got: ${result.permission}`);
  }
});

await asyncTest('checkMergePermissions returns false for repos without write access', async () => {
  // torvalds/linux is a public repo where we definitely don't have write access
  const result = await checkMergePermissions('torvalds', 'linux', false);
  assert.equal(result.canMerge, false, 'Should return canMerge=false for read-only repo');
  assert.equal(result.permission, 'read', 'Should return permission=read for read-only repo');
});

// ============================================================================
// Fork mode guard logic tests (unit tests with mocks)
// ============================================================================

console.log('\n📋 Fork Mode Guard Logic Tests\n');

test('Fork mode guard should block auto-merge when argv.fork is true', () => {
  // Simulate the condition from startAutoRestartUntilMergable
  const argv = { fork: true, autoMerge: true };
  const isAutoMerge = argv.autoMerge || false;

  const shouldBlockForFork = argv.fork && isAutoMerge;
  assert.equal(shouldBlockForFork, true, 'Should block auto-merge in fork mode');
});

test('Fork mode guard should not block when argv.fork is false', () => {
  const argv = { fork: false, autoMerge: true };
  const isAutoMerge = argv.autoMerge || false;

  const shouldBlockForFork = argv.fork && isAutoMerge;
  assert.equal(shouldBlockForFork, false, 'Should not block auto-merge when not in fork mode');
});

test('Fork mode guard should not block auto-restart-until-mergable (only auto-merge)', () => {
  const argv = { fork: true, autoMerge: false, autoRestartUntilMergable: true };
  const isAutoMerge = argv.autoMerge || false;

  const shouldBlockForFork = argv.fork && isAutoMerge;
  assert.equal(shouldBlockForFork, false, 'Should not block auto-restart-until-mergable even in fork mode');
});

test('Fork mode guard should handle undefined argv.fork', () => {
  const argv = { autoMerge: true };
  const isAutoMerge = argv.autoMerge || false;

  const shouldBlockForFork = argv.fork && isAutoMerge;
  assert.equal(shouldBlockForFork, undefined, 'Should be falsy when argv.fork is undefined');
  assert.ok(!shouldBlockForFork, 'Should not block when argv.fork is undefined');
});

// ============================================================================
// Permission pre-check logic tests
// ============================================================================

console.log('\n📋 Permission Pre-check Logic Tests\n');

test('Permission check should correctly identify read-only access as non-mergeable', () => {
  const permissions = { admin: false, maintain: false, push: false, pull: true, triage: false };
  const canMerge = permissions.admin === true || permissions.maintain === true || permissions.push === true;
  assert.equal(canMerge, false, 'Read-only permissions should not allow merge');
});

test('Permission check should correctly identify push access as mergeable', () => {
  const permissions = { admin: false, maintain: false, push: true, pull: true, triage: false };
  const canMerge = permissions.admin === true || permissions.maintain === true || permissions.push === true;
  assert.equal(canMerge, true, 'Push permissions should allow merge');
});

test('Permission check should correctly identify admin access as mergeable', () => {
  const permissions = { admin: true, maintain: false, push: true, pull: true, triage: false };
  const canMerge = permissions.admin === true || permissions.maintain === true || permissions.push === true;
  assert.equal(canMerge, true, 'Admin permissions should allow merge');
});

test('Permission check should correctly identify maintain access as mergeable', () => {
  const permissions = { admin: false, maintain: true, push: true, pull: true, triage: false };
  const canMerge = permissions.admin === true || permissions.maintain === true || permissions.push === true;
  assert.equal(canMerge, true, 'Maintain permissions should allow merge');
});

test('Permission check should correctly identify triage-only access as non-mergeable', () => {
  const permissions = { admin: false, maintain: false, push: false, pull: true, triage: true };
  const canMerge = permissions.admin === true || permissions.maintain === true || permissions.push === true;
  assert.equal(canMerge, false, 'Triage-only permissions should not allow merge');
});

// ============================================================================
// Summary
// ============================================================================

console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed, ${testsPassed + testsFailed} total\n`);
process.exit(testsFailed > 0 ? 1 : 0);
