#!/usr/bin/env node
/**
 * Issue #2404: the branch CI health check must look past commits that have no CI of their own.
 *
 * In production, main's HEAD moved from cb3bb2d (merge of PR #2403, "Checks and release" running,
 * later failed) to 6702efe — the `2.33.4` release bump pushed by github-actions[bot] with
 * GITHUB_TOKEN, which starts no workflows. The old check saw 0 runs on HEAD and returned
 * "healthy". The data below is taken from the GitHub API (see docs/case-studies/issue-2404/data).
 *
 * Run with: node tests/test-branch-ci-health-walkback-2404.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2404
 */

import assert from 'node:assert/strict';
import { evaluateBranchCIHealth, firstParentChain, BRANCH_CI_LOOKBACK_COMMITS } from '../src/github-branch-ci-health.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

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

const SHA = {
  c62b9fb: 'c62b9fb0000000000000000000000000000000000',
  cb3bb2d: 'cb3bb2d4dc9d7c50d4e262dcfcc01a912027618b',
  '6702efe': '6702efe57cd1ddd86927d242381bf012f85ca27d',
  '5ddb537': '5ddb537ff9e110c70348ec7df3842a8ae5fe86cd',
  4828010: '48280105b0369ac1097170e1465ca091cc3e2774',
};

const commit = (key, parent, date, message) => ({ sha: SHA[key], parent: parent ? SHA[parent] : null, date, message });
const C62B9FB = commit('c62b9fb', null, '2026-10-01T18:32:30Z', 'Revert "Initial commit with task details"');
const CB3BB2D = commit('cb3bb2d', 'c62b9fb', '2026-10-01T19:27:54Z', 'Merge pull request #2403');
const BUMP_2_33_4 = commit('6702efe', 'cb3bb2d', '2026-10-01T19:37:27Z', '2.33.4');
const M_5DDB537 = commit('5ddb537', '6702efe', '2026-10-01T19:56:45Z', 'Merge pull request #2398');
const BUMP_2_33_5 = commit('4828010', '5ddb537', '2026-10-01T20:06:28Z', '2.33.5');

const run = (name, event, status, conclusion, id = Math.floor(Math.random() * 1e6)) => ({ id, name, event, status, conclusion, html_url: `https://github.com/link-assistant/hive-mind/actions/runs/${id}` });
const CHECKS_FAILED = run('Checks and release', 'push', 'completed', 'failure', 36914477944);
const CHECKS_RUNNING = { ...CHECKS_FAILED, status: 'in_progress', conclusion: null };

const at = iso => Date.parse(iso);

/** Build a getRuns() stub from a SHA → runs map, counting calls. */
function runsFrom(map) {
  const calls = [];
  const getRuns = async sha => {
    calls.push(sha);
    return map[sha] || [];
  };
  return { getRuns, calls };
}

console.log('\n📋 Issue #2404: branch CI health walks back past commits without CI\n');

await asyncTest('Production replay: HEAD = run-less 2.33.4 bump, parent run failed → unhealthy', async () => {
  const { getRuns } = runsFrom({
    [SHA.cb3bb2d]: [run('Workflows', 'push', 'completed', 'success'), run('Broken Link Checker', 'push', 'completed', 'success'), CHECKS_FAILED, run('Security', 'push', 'completed', 'success')],
  });
  const result = await evaluateBranchCIHealth({ branch: 'main', commits: [BUMP_2_33_4, CB3BB2D, C62B9FB], getRuns, now: at('2026-10-01T19:56:20Z') });
  assert.equal(result.healthy, false, 'red main must be detected through the bump commit');
  assert.equal(result.headSha, SHA['6702efe']);
  assert.equal(result.checkedSha, SHA.cb3bb2d);
  assert.equal(result.skippedCommits, 1);
  assert.deepEqual(result.failedRuns, [CHECKS_FAILED]);
  assert.match(result.error, /Checks and release/);
  assert.match(result.error, /cb3bb2d/);
});

await asyncTest('Bump commit on top of a still-running parent → pending (wait), not healthy', async () => {
  const { getRuns } = runsFrom({ [SHA.cb3bb2d]: [CHECKS_RUNNING] });
  const result = await evaluateBranchCIHealth({ branch: 'main', commits: [BUMP_2_33_4, CB3BB2D], getRuns, now: at('2026-10-01T19:40:00Z') });
  assert.equal(result.healthy, true);
  assert.equal(result.pending, true);
  assert.deepEqual(result.pendingRuns, [CHECKS_RUNNING]);
  assert.equal(result.checkedSha, SHA.cb3bb2d);
});

await asyncTest('Just-pushed HEAD without runs (inside grace period) → pending, parent is not judged yet', async () => {
  const { getRuns, calls } = runsFrom({ [SHA.cb3bb2d]: [CHECKS_FAILED] });
  const result = await evaluateBranchCIHealth({ branch: 'main', commits: [BUMP_2_33_4, CB3BB2D], getRuns, now: at('2026-10-01T19:37:40Z') });
  assert.equal(result.healthy, true);
  assert.equal(result.pending, true);
  assert.deepEqual(result.pendingRuns, []);
  assert.deepEqual(calls, [SHA['6702efe']], 'should not look at the parent while HEAD runs may still appear');
});

await asyncTest('HEAD with only an issues-event run (2.33.5 + "Formal AI Draft") → judged on 5ddb537 (green)', async () => {
  const { getRuns } = runsFrom({
    [SHA['4828010']]: [run('Formal AI Draft', 'issues', 'completed', 'success')],
    [SHA['5ddb537']]: [run('Checks and release', 'push', 'completed', 'success', 36917996687), run('Broken Link Checker', 'push', 'completed', 'success'), run('Security', 'push', 'completed', 'success')],
  });
  const result = await evaluateBranchCIHealth({ branch: 'main', commits: [BUMP_2_33_5, M_5DDB537, BUMP_2_33_4, CB3BB2D], getRuns, now: at('2026-10-01T20:27:10Z') });
  assert.equal(result.healthy, true);
  assert.equal(result.pending, false);
  assert.equal(result.checkedSha, SHA['5ddb537']);
  assert.equal(result.skippedCommits, 1);
});

await asyncTest('Issue #1425 preserved: HEAD has its own green CI → older red commit is ignored', async () => {
  const { getRuns, calls } = runsFrom({
    [SHA['5ddb537']]: [run('Checks and release', 'push', 'completed', 'success')],
    [SHA.cb3bb2d]: [CHECKS_FAILED],
  });
  const result = await evaluateBranchCIHealth({ branch: 'main', commits: [M_5DDB537, BUMP_2_33_4, CB3BB2D], getRuns, now: at('2026-10-01T20:30:00Z') });
  assert.equal(result.healthy, true);
  assert.equal(result.pending, false);
  assert.deepEqual(calls, [SHA['5ddb537']], 'ancestors must not be queried when HEAD has CI');
});

await asyncTest('Issue #1425 preserved: HEAD CI in progress → pending even if an ancestor failed', async () => {
  const { getRuns } = runsFrom({ [SHA['5ddb537']]: [run('Checks and release', 'push', 'in_progress', null)], [SHA.cb3bb2d]: [CHECKS_FAILED] });
  const result = await evaluateBranchCIHealth({ branch: 'main', commits: [M_5DDB537, BUMP_2_33_4, CB3BB2D], getRuns, now: at('2026-10-01T20:00:00Z') });
  assert.equal(result.healthy, true);
  assert.equal(result.pending, true);
});

await asyncTest('Repository without push CI → falls back to HEAD runs (0 runs = healthy, as before)', async () => {
  const { getRuns, calls } = runsFrom({});
  const result = await evaluateBranchCIHealth({ branch: 'main', commits: [BUMP_2_33_4, CB3BB2D, C62B9FB], getRuns, now: at('2026-10-02T00:00:00Z') });
  assert.equal(result.healthy, true);
  assert.equal(result.pending, false);
  assert.equal(calls.length, 3);
});

await asyncTest('Look-back is bounded', async () => {
  const commits = Array.from({ length: 30 }, (_, i) => ({ sha: `sha${i}`, parent: `sha${i + 1}`, date: '2026-01-01T00:00:00Z' }));
  const { getRuns, calls } = runsFrom({ sha25: [CHECKS_FAILED] });
  const result = await evaluateBranchCIHealth({ branch: 'main', commits, getRuns, now: at('2026-10-01T00:00:00Z') });
  assert.equal(calls.length, BRANCH_CI_LOOKBACK_COMMITS);
  assert.equal(result.healthy, true, 'a failure beyond the look-back window is not reported');
});

await asyncTest('Runs without an event field still count as branch CI (backwards compatible)', async () => {
  const { getRuns } = runsFrom({ [SHA['6702efe']]: [{ id: 1, name: 'CI', status: 'completed', conclusion: 'failure' }] });
  const result = await evaluateBranchCIHealth({ branch: 'main', commits: [BUMP_2_33_4, CB3BB2D], getRuns, now: at('2026-10-01T20:00:00Z') });
  assert.equal(result.healthy, false);
  assert.equal(result.checkedSha, SHA['6702efe']);
});

await asyncTest('Empty commit list → healthy with no SHA (API problem is not a merge blocker)', async () => {
  const result = await evaluateBranchCIHealth({ branch: 'main', commits: [], getRuns: async () => [] });
  assert.equal(result.healthy, true);
  assert.equal(result.headSha, null);
});

await asyncTest('firstParentChain follows parents[0] and skips side-branch commits', async () => {
  const commits = [
    { sha: 'merge', parent: 'base' },
    { sha: 'feature', parent: 'base' },
    { sha: 'base', parent: 'root' },
    { sha: 'root', parent: null },
  ];
  assert.deepEqual(
    firstParentChain(commits).map(c => c.sha),
    ['merge', 'base', 'root']
  );
});

console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed\n`);
if (testsFailed > 0) process.exit(1);
