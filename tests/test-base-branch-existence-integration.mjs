#!/usr/bin/env node

/**
 * Integration tests for issue #1959 — the base-branch existence gate that runs
 * against the real GitHub API via `gh`.
 *
 * Verifies, against the public link-assistant/hive-mind repository:
 *   1. checkBaseBranchExists() returns {exists:true} for a branch that exists
 *      (the default branch "main").
 *   2. checkBaseBranchExists() returns {exists:false} for a branch that does
 *      not exist.
 *   3. validateGitHubEntityExistence() fails at level "branch" with a
 *      descriptive message when a non-existent --base-branch is supplied,
 *      BEFORE any issue/PR lookup or clone is attempted.
 *
 * Requires: `gh` authenticated with network access. Skipped by default; run via
 *   HIVE_MIND_RUN_INTEGRATION=1 node tests/test-base-branch-existence-integration.mjs
 *   (or `node scripts/run-tests.mjs --suite integration`).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1959
 * @hive-mind-integration
 */

import { checkBaseBranchExists, validateGitHubEntityExistence } from '../src/github-entity-validation.lib.mjs';
import { skipUnlessIntegration } from './integration-guard.mjs';

skipUnlessIntegration(import.meta.url);

const OWNER = 'link-assistant';
const REPO = 'hive-mind';
const MISSING_BRANCH = 'this-branch-definitely-does-not-exist-1959';

let passed = 0;
let failed = 0;

function assert(name, condition, message = 'assertion failed') {
  if (condition) {
    console.log(`✅ ${name}`);
    passed++;
  } else {
    console.log(`❌ ${name}: ${message}`);
    failed++;
  }
}

console.log('\n🧪 Base Branch Existence — Integration (Issue #1959)\n');

// 1. Existing branch
const existing = await checkBaseBranchExists({ owner: OWNER, repo: REPO, baseBranch: 'main' });
assert('checkBaseBranchExists: "main" exists', existing.exists === true, JSON.stringify(existing));

// 2. Missing branch
const missing = await checkBaseBranchExists({ owner: OWNER, repo: REPO, baseBranch: MISSING_BRANCH });
assert('checkBaseBranchExists: non-existent branch → exists:false', missing.exists === false && !missing.indeterminate, JSON.stringify(missing));

// 3. Full validation gate fails fast at the branch level with a descriptive message.
const result = await validateGitHubEntityExistence({
  owner: OWNER,
  repo: REPO,
  number: 1,
  type: 'issue',
  baseBranch: MISSING_BRANCH,
});
assert('validateGitHubEntityExistence: invalid result', result.valid === false, JSON.stringify(result));
assert('validateGitHubEntityExistence: level is "branch"', result.level === 'branch', JSON.stringify(result));
assert('validateGitHubEntityExistence: error names the missing branch', typeof result.error === 'string' && result.error.includes(MISSING_BRANCH), String(result.error));

console.log(`\n📊 Test Summary: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('\n🎉 All tests passed!');
