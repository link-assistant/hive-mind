#!/usr/bin/env node

/**
 * Test suite for cross-fork PR branch checkout (Issue #1464)
 *
 * Tests that when a PR comes from another user's fork, the prForkRemote and
 * prForkOwner values are correctly forwarded through the call chain:
 *   solve.mjs → createOrCheckoutBranch → checkoutPrBranch
 *
 * The bug was that setupRepositoryAndClone returned prForkRemote/prForkOwner
 * but solve.mjs didn't destructure or forward them, causing checkoutPrBranch
 * to default to 'origin' (which doesn't have the fork branch).
 */

import { readFileSync } from 'fs';
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

console.log('🧪 Cross-Fork PR Branch Checkout Tests (Issue #1464)\n');

// ─── solve.mjs tests ───

const solveMjsContent = readFileSync(join(srcDir, 'solve.mjs'), 'utf8');

runTest('solve.mjs destructures prForkRemote from setupRepositoryAndClone', () => {
  assert(solveMjsContent.includes('prForkRemote') && solveMjsContent.match(/const\s*\{[^}]*prForkRemote[^}]*\}\s*=\s*await\s+setupRepositoryAndClone/s), 'solve.mjs should destructure prForkRemote from setupRepositoryAndClone return value');
});

runTest('solve.mjs destructures prForkOwner from setupRepositoryAndClone', () => {
  assert(solveMjsContent.includes('prForkOwner') && solveMjsContent.match(/const\s*\{[^}]*prForkOwner[^}]*\}\s*=\s*await\s+setupRepositoryAndClone/s), 'solve.mjs should destructure prForkOwner from setupRepositoryAndClone return value');
});

runTest('solve.mjs passes prForkRemote to createOrCheckoutBranch', () => {
  // Find the createOrCheckoutBranch call and verify prForkRemote is in its arguments
  const callMatch = solveMjsContent.match(/createOrCheckoutBranch\(\{[\s\S]*?\}\)/);
  assert(callMatch, 'createOrCheckoutBranch call should exist in solve.mjs');
  assert(callMatch[0].includes('prForkRemote'), 'createOrCheckoutBranch call should include prForkRemote parameter');
});

runTest('solve.mjs passes prForkOwner to createOrCheckoutBranch', () => {
  const callMatch = solveMjsContent.match(/createOrCheckoutBranch\(\{[\s\S]*?\}\)/);
  assert(callMatch, 'createOrCheckoutBranch call should exist in solve.mjs');
  assert(callMatch[0].includes('prForkOwner'), 'createOrCheckoutBranch call should include prForkOwner parameter');
});

// ─── solve.branch.lib.mjs tests ───

const branchLibContent = readFileSync(join(srcDir, 'solve.branch.lib.mjs'), 'utf8');

runTest('createOrCheckoutBranch accepts prForkRemote parameter', () => {
  const sig = branchLibContent.match(/createOrCheckoutBranch\(\{[^}]*\}\)/);
  assert(sig, 'createOrCheckoutBranch signature should exist');
  assert(sig[0].includes('prForkRemote'), 'createOrCheckoutBranch should accept prForkRemote in its destructured parameters');
});

runTest('createOrCheckoutBranch accepts prForkOwner parameter', () => {
  const sig = branchLibContent.match(/createOrCheckoutBranch\(\{[^}]*\}\)/);
  assert(sig, 'createOrCheckoutBranch signature should exist');
  assert(sig[0].includes('prForkOwner'), 'createOrCheckoutBranch should accept prForkOwner in its destructured parameters');
});

runTest('checkoutPrBranch is called with prForkRemote (not null)', () => {
  // The call to checkoutPrBranch should reference prForkRemote, not just pass null
  const callMatch = branchLibContent.match(/checkoutPrBranch\([^)]+\)/g);
  assert(callMatch, 'checkoutPrBranch call should exist in solve.branch.lib.mjs');

  const hasProperRemoteArg = callMatch.some(call => call.includes('prForkRemote'));
  assert(hasProperRemoteArg, 'checkoutPrBranch should receive prForkRemote (not hardcoded null) as the remote argument');
});

runTest('checkoutPrBranch is called with prForkOwner (not null)', () => {
  const callMatch = branchLibContent.match(/checkoutPrBranch\([^)]+\)/g);
  assert(callMatch, 'checkoutPrBranch call should exist in solve.branch.lib.mjs');

  const hasProperOwnerArg = callMatch.some(call => call.includes('prForkOwner'));
  assert(hasProperOwnerArg, 'checkoutPrBranch should receive prForkOwner (not hardcoded null) as the owner argument');
});

// ─── solve.repository.lib.mjs tests ───

const repoLibContent = readFileSync(join(srcDir, 'solve.repository.lib.mjs'), 'utf8');

runTest('checkoutPrBranch uses prForkRemote as remoteName when provided', () => {
  // Verify the function defaults to 'origin' only when prForkRemote is not provided
  assert(repoLibContent.includes("const remoteName = prForkRemote || 'origin'"), 'checkoutPrBranch should use prForkRemote when provided, falling back to origin');
});

runTest('setupPrForkRemote returns the pr-fork remote name', () => {
  // Verify setupPrForkRemote returns 'pr-fork' string
  assert(repoLibContent.includes("return 'pr-fork'"), 'setupPrForkRemote should return the string "pr-fork"');
});

// ─── solve.repo-setup.lib.mjs tests ───

const repoSetupContent = readFileSync(join(srcDir, 'solve.repo-setup.lib.mjs'), 'utf8');

runTest('setupRepositoryAndClone returns prForkRemote in its return value', () => {
  const returnMatch = repoSetupContent.match(/return\s*\{[^}]*prForkRemote[^}]*\}/);
  assert(returnMatch, 'setupRepositoryAndClone should include prForkRemote in its return object');
});

runTest('setupRepositoryAndClone returns prForkOwner in its return value', () => {
  const returnMatch = repoSetupContent.match(/return\s*\{[^}]*prForkOwner[^}]*\}/);
  assert(returnMatch, 'setupRepositoryAndClone should include prForkOwner in its return object');
});

// ─── Summary ───

console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed, ${testsPassed + testsFailed} total`);
process.exit(testsFailed > 0 ? 1 : 0);
