#!/usr/bin/env node
/**
 * Reproduction for issue #1803: --auto-fork mode does not work.
 *
 * Root cause: in solve.repository.lib.mjs setupRepository(), when continuing
 * a fork PR, the existing-fork-lookup path builds an "expected fork name" by
 * applying the --prefix-fork-name-with-owner-name option to forkRepoName.
 * forkRepoName already comes from the PR's headRepository.name (which is the
 * actual fork repo name on GitHub), so re-prefixing produces a doubled prefix
 * like "owner/owner-owner-repo" — which doesn't exist.
 *
 * Concrete scenario from the failing log
 * (https://github.com/labtgbot/telegram-claude-agent/pull/4#issuecomment-4463389730):
 *   upstream:        labtgbot/telegram-claude-agent
 *   PR head repo:    konard/labtgbot-telegram-claude-agent
 *   forkRepoName:    labtgbot-telegram-claude-agent  (from headRepository.name)
 *   prefix flag:     true (default)
 *
 * Current code:
 *   headRepoName     = forkRepoName || repo
 *                    = "labtgbot-telegram-claude-agent"
 *   prefixedForkName = `${forkOwner}/${owner}-${headRepoName}`
 *                    = "konard/labtgbot-labtgbot-telegram-claude-agent"  <- BUG
 *
 * Expected behavior: when forkRepoName is known from PR data, that IS the
 * authoritative fork name; the prefix option is for fork *creation*, not
 * fork *lookup*, and applying it here is a logic error.
 */

import assert from 'node:assert';

function buggyComputeForkName({ owner, repo, forkOwner, forkRepoName, prefixForkNameWithOwnerName }) {
  const headRepoName = forkRepoName || repo;
  const standardForkName = `${forkOwner}/${headRepoName}`;
  const prefixedForkName = `${forkOwner}/${owner}-${headRepoName}`;
  return prefixForkNameWithOwnerName ? prefixedForkName : standardForkName;
}

function fixedComputeForkName({ owner, repo, forkOwner, forkRepoName, prefixForkNameWithOwnerName }) {
  if (forkRepoName) {
    // PR head data is authoritative — use it directly.
    return `${forkOwner}/${forkRepoName}`;
  }
  const standardForkName = `${forkOwner}/${repo}`;
  const prefixedForkName = `${forkOwner}/${owner}-${repo}`;
  return prefixForkNameWithOwnerName ? prefixedForkName : standardForkName;
}

const scenario = {
  owner: 'labtgbot',
  repo: 'telegram-claude-agent',
  forkOwner: 'konard',
  forkRepoName: 'labtgbot-telegram-claude-agent',
  prefixForkNameWithOwnerName: true,
};

console.log('Scenario:', scenario);
console.log('  buggy result:', buggyComputeForkName(scenario));
console.log('  fixed result:', fixedComputeForkName(scenario));

assert.strictEqual(buggyComputeForkName(scenario), 'konard/labtgbot-labtgbot-telegram-claude-agent', 'reproducing the documented bug: double prefix');
assert.strictEqual(fixedComputeForkName(scenario), 'konard/labtgbot-telegram-claude-agent', 'fixed: trust forkRepoName from PR head data');

// Sanity checks for unrelated scenarios
const guessScenario = {
  owner: 'someone',
  repo: 'their-repo',
  forkOwner: 'me',
  forkRepoName: null, // PR data did not include headRepository.name
  prefixForkNameWithOwnerName: true,
};
assert.strictEqual(fixedComputeForkName(guessScenario), 'me/someone-their-repo');
assert.strictEqual(fixedComputeForkName({ ...guessScenario, prefixForkNameWithOwnerName: false }), 'me/their-repo');

// Different scenario: forkRepoName equals repo (the fork has the same name as upstream)
const sameNameScenario = {
  owner: 'someone',
  repo: 'their-repo',
  forkOwner: 'me',
  forkRepoName: 'their-repo',
  prefixForkNameWithOwnerName: true,
};
assert.strictEqual(fixedComputeForkName(sameNameScenario), 'me/their-repo');
// And the buggy version would incorrectly add the prefix:
assert.strictEqual(buggyComputeForkName(sameNameScenario), 'me/someone-their-repo');

console.log('\n✅ Bug reproduced, fix verified by simulation.');
