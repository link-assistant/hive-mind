#!/usr/bin/env node

/**
 * Unit tests for issue #1959 — make a missing/mistyped --base-branch fail fast
 * with a descriptive message instead of an opaque "Branch operation failed".
 *
 * Covers, without any network access:
 *   1. levenshteinDistance() — edit-distance helper used for suggestions.
 *   2. findClosestBranchName() — "did you mean" suggestion logic, including the
 *      exact real-world typo from the issue (an extra trailing character).
 *   3. handleBranchCreationError() — the misdiagnosis fix: a missing custom base
 *      branch must NOT be reported as "the repository appears to be empty", while
 *      a genuinely empty repository (default branch) still is.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1959
 */

import { levenshteinDistance, findClosestBranchName } from '../src/github-entity-validation.lib.mjs';
import { handleBranchCreationError } from '../src/solve.branch-errors.lib.mjs';

let passed = 0;
let failed = 0;

function pass(name) {
  console.log(`✅ ${name}`);
  passed++;
}

function fail(name, message) {
  console.log(`❌ ${name}: ${message}`);
  failed++;
}

function assert(name, condition, message = 'assertion failed') {
  if (condition) pass(name);
  else fail(name, message);
}

console.log('\n🧪 Base Branch Existence Tests (Issue #1959)\n');

// === levenshteinDistance ===

assert('levenshtein: identical strings → 0', levenshteinDistance('main', 'main') === 0);
assert('levenshtein: empty vs string', levenshteinDistance('', 'main') === 4);
assert('levenshtein: single insertion', levenshteinDistance('main', 'mains') === 1);
assert('levenshtein: single substitution', levenshteinDistance('kitten', 'sitten') === 1);
assert('levenshtein: classic kitten→sitting', levenshteinDistance('kitten', 'sitting') === 3);
assert('levenshtein: the real typo (extra trailing 0)', levenshteinDistance('issue-375-8a4323e580780', 'issue-375-8a4323e58078') === 1);

// === findClosestBranchName ===

const realBranches = ['main', 'red_hood', 'issue-373-7440fc7c0906', 'issue-375-8a4323e58078', 'issue-371-0fcf92c8a251'];

assert('closest: real-world typo suggests the intended branch', findClosestBranchName('issue-375-8a4323e580780', realBranches) === 'issue-375-8a4323e58078');

assert('closest: exact match is skipped, returns null when only itself', findClosestBranchName('main', ['main']) === null);

assert('closest: a near-miss on a short branch is suggested', findClosestBranchName('mian', ['main', 'develop']) === 'main');

assert('closest: totally unrelated input returns null (no misleading suggestion)', findClosestBranchName('completely-different-xyz', ['main', 'develop']) === null);

assert('closest: empty candidates → null', findClosestBranchName('main', []) === null);
assert('closest: null target → null', findClosestBranchName(null, realBranches) === null);

// === handleBranchCreationError: misdiagnosis fix ===

async function captureBranchCreationError(opts) {
  const lines = [];
  const log = async msg => {
    lines.push(typeof msg === 'string' ? msg : String(msg));
  };
  const formatAligned = (icon, label, value) => `${icon} ${label} ${value}`.trim();
  await handleBranchCreationError({ formatAligned, log, tempDir: '/tmp/x', owner: 'rumaster', repo: 'tg-games', ...opts });
  return lines.join('\n');
}

// The exact failing git output from the issue's log.
const missingBaseErrorOutput = "fatal: 'origin/issue-375-8a4323e580780' is not a commit and a branch 'issue-377-1fc1b18d1d9d' cannot be created from it";

const customOutput = await captureBranchCreationError({
  branchName: 'issue-377-1fc1b18d1d9d',
  errorOutput: missingBaseErrorOutput,
  baseBranch: 'issue-375-8a4323e580780',
  branchSource: 'custom',
});

assert('misdiagnosis: custom base branch → reports the base branch as the root cause', customOutput.includes("base branch 'issue-375-8a4323e580780' does not exist"), customOutput);
assert('misdiagnosis: custom base branch → does NOT claim the repository is empty', !customOutput.includes('repository appears to be empty'), customOutput);
assert('misdiagnosis: custom base branch → does NOT suggest --auto-init-repository', !customOutput.includes('--auto-init-repository'), customOutput);

// A genuinely empty repository creates from the DEFAULT branch — behavior must be unchanged.
const emptyRepoOutput = await captureBranchCreationError({
  branchName: 'issue-1-abcdef012345',
  errorOutput: "fatal: 'origin/main' is not a commit and a branch 'issue-1-abcdef012345' cannot be created from it",
  baseBranch: 'main',
  branchSource: 'default',
});

assert('empty repo: default branch still reports empty repository root cause', emptyRepoOutput.includes('repository appears to be empty'), emptyRepoOutput);
assert('empty repo: default branch still suggests --auto-init-repository', emptyRepoOutput.includes('--auto-init-repository'), emptyRepoOutput);

// Summary
console.log(`\n📊 Test Summary: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('\n🎉 All tests passed!');
