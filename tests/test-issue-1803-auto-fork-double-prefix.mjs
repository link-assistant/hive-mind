#!/usr/bin/env node
// @hive-mind-test-suite default

/**
 * Test suite for Issue #1803: --auto-fork mode does not work.
 *
 * Bug: in solve.repository.lib.mjs setupRepository(), when continuing a fork
 * PR (forkOwner branch with forkRepoName known from headRepository.name),
 * the code applied --prefix-fork-name-with-owner-name to forkRepoName. Since
 * forkRepoName is already authoritative (e.g. "labtgbot-telegram-claude-agent")
 * the result was a doubled prefix ("konard/labtgbot-labtgbot-telegram-claude-agent")
 * and the fork lookup failed even though the actual fork exists.
 *
 * Fix: when forkRepoName is provided from PR head data, trust it directly.
 * The --prefix-fork-name-with-owner-name option only controls how new forks
 * are CREATED, not how an existing fork PR is looked up.
 *
 * Scenario from the failing log
 * (https://github.com/labtgbot/telegram-claude-agent/pull/4#issuecomment-4463389730):
 *   upstream:        labtgbot/telegram-claude-agent
 *   PR head:         konard/labtgbot-telegram-claude-agent
 *   forkRepoName:    labtgbot-telegram-claude-agent
 *   prefix flag:     true (default)
 *   Before fix:      expectedForkName = "konard/labtgbot-labtgbot-telegram-claude-agent"
 *   After fix:       expectedForkName = "konard/labtgbot-telegram-claude-agent"
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

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

const repoLib = readFileSync(join(srcDir, 'solve.repository.lib.mjs'), 'utf8');

// Test 1: When forkRepoName is provided, expectedForkName uses it directly (no prefix).
runTest('expectedForkName trusts forkRepoName directly', () => {
  // The fix uses a ternary: forkRepoName ? `${forkOwner}/${forkRepoName}` : ...
  // and alternateForkName = forkRepoName ? null : ...
  if (!repoLib.includes('forkRepoName ? `${forkOwner}/${forkRepoName}`')) {
    throw new Error('expectedForkName should resolve to `${forkOwner}/${forkRepoName}` when forkRepoName is provided');
  }
  if (!repoLib.includes('alternateForkName = forkRepoName ? null')) {
    throw new Error('alternateForkName should be null when forkRepoName is provided (authoritative)');
  }
});

// Test 2: The prefix flag only controls the guess branch (when forkRepoName is missing).
runTest('prefix flag only controls the guess branch', () => {
  // Look for the guess fallback inside the ternary: argv.prefixForkNameWithOwnerName ? prefixedForkName : standardForkName
  if (!repoLib.includes('argv.prefixForkNameWithOwnerName ? prefixedForkName : standardForkName')) {
    throw new Error('Guess branch (expectedForkName) should still respect --prefix-fork-name-with-owner-name');
  }
  if (!repoLib.includes('argv.prefixForkNameWithOwnerName ? standardForkName : prefixedForkName')) {
    throw new Error('Guess branch (alternateForkName) should still respect --prefix-fork-name-with-owner-name');
  }
});

// Test 3: The fallback lookup is gated on alternateForkName existing AND prefix flag off.
runTest('fallback lookup only attempted when alternate is meaningful', () => {
  if (!repoLib.includes('alternateForkName && !argv.prefixForkNameWithOwnerName')) {
    throw new Error('Fallback should be gated on alternateForkName presence and prefix flag being off');
  }
});

// Test 4: Issue #1803 is referenced in the source so the rationale is discoverable.
runTest('source references issue #1803', () => {
  if (!/Issue #1803/.test(repoLib)) {
    throw new Error('source should reference Issue #1803 for context');
  }
});

// --- Pure-logic simulation tests for the fix ---
//
// These mirror the patched logic so future changes that regress it will be
// caught even without spinning up the full setupRepository flow.

function computeExpectedForkName({ owner, repo, forkOwner, forkRepoName, prefixForkNameWithOwnerName }) {
  const headRepoName = forkRepoName || repo;
  const standardForkName = `${forkOwner}/${headRepoName}`;
  const prefixedForkName = `${forkOwner}/${owner}-${headRepoName}`;
  if (forkRepoName) {
    return `${forkOwner}/${forkRepoName}`;
  }
  return prefixForkNameWithOwnerName ? prefixedForkName : standardForkName;
}

// Test 5: Concrete #1803 scenario produces the correct fork name.
runTest('issue #1803 concrete scenario', () => {
  const got = computeExpectedForkName({
    owner: 'labtgbot',
    repo: 'telegram-claude-agent',
    forkOwner: 'konard',
    forkRepoName: 'labtgbot-telegram-claude-agent',
    prefixForkNameWithOwnerName: true,
  });
  if (got !== 'konard/labtgbot-telegram-claude-agent') {
    throw new Error(`Expected konard/labtgbot-telegram-claude-agent, got ${got}`);
  }
});

// Test 6: Authoritative path ignores the prefix flag.
runTest('authoritative path ignores prefix flag', () => {
  const a = computeExpectedForkName({
    owner: 'labtgbot',
    repo: 'telegram-claude-agent',
    forkOwner: 'konard',
    forkRepoName: 'labtgbot-telegram-claude-agent',
    prefixForkNameWithOwnerName: true,
  });
  const b = computeExpectedForkName({
    owner: 'labtgbot',
    repo: 'telegram-claude-agent',
    forkOwner: 'konard',
    forkRepoName: 'labtgbot-telegram-claude-agent',
    prefixForkNameWithOwnerName: false,
  });
  if (a !== b) {
    throw new Error(`Authoritative path should be stable across prefix flag values: ${a} vs ${b}`);
  }
});

// Test 7: Guess path still respects the prefix flag.
runTest('guess path still respects prefix flag', () => {
  const prefixed = computeExpectedForkName({
    owner: 'someone',
    repo: 'their-repo',
    forkOwner: 'me',
    forkRepoName: null,
    prefixForkNameWithOwnerName: true,
  });
  if (prefixed !== 'me/someone-their-repo') {
    throw new Error(`Guess+prefix expected me/someone-their-repo, got ${prefixed}`);
  }
  const standard = computeExpectedForkName({
    owner: 'someone',
    repo: 'their-repo',
    forkOwner: 'me',
    forkRepoName: null,
    prefixForkNameWithOwnerName: false,
  });
  if (standard !== 'me/their-repo') {
    throw new Error(`Guess-no-prefix expected me/their-repo, got ${standard}`);
  }
});

// Test 8: Same-name fork (forkRepoName equals repo) does not get a doubled prefix.
runTest('same-name fork does not get a doubled prefix', () => {
  const got = computeExpectedForkName({
    owner: 'someone',
    repo: 'their-repo',
    forkOwner: 'me',
    forkRepoName: 'their-repo',
    prefixForkNameWithOwnerName: true,
  });
  if (got !== 'me/their-repo') {
    throw new Error(`Same-name fork should yield me/their-repo, got ${got}`);
  }
});

// Test 9: setupRepository signature is unchanged (no breaking change to callers).
runTest('setupRepository signature unchanged', () => {
  const sig = 'export const setupRepository = async (argv, owner, repo, forkOwner = null, issueUrl = null, forkRepoName = null) =>';
  if (!repoLib.includes(sig)) {
    throw new Error('setupRepository signature changed unexpectedly');
  }
});

// Summary
console.log('\n' + '='.repeat(60));
console.log('Test Results for Issue #1803 (--auto-fork double prefix):');
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(60));

process.exit(testsFailed > 0 ? 1 : 0);
