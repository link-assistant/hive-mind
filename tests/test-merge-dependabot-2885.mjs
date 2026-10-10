#!/usr/bin/env node
/**
 * Merge Queue Tests — Issue #2885
 *
 * `/merge <repo> --dependabot` adds open Dependabot version bump PRs to the
 * sequential, CI-gated merge queue (they never carry the `ready` label), and
 * `--auto-resolve` also hands Dependabot PRs whose CI failed (e.g. a missing
 * changelog fragment, as in link-assistant/router#758) to `/solve --auto-merge`.
 *
 * Run with: node tests/test-merge-dependabot-2885.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2885
 */

import assert from 'node:assert/strict';
import { DEPENDABOT_AUTHOR, fetchDependabotPullRequests, isDependabotPullRequest, mergeDependabotItems } from '../src/github-merge-dependabot.lib.mjs';
import { CI_FAILED_REASON, MERGE_CONFLICT_SKIP_REASON, MergeItemStatus, MergeQueueProcessor } from '../src/telegram-merge-queue.lib.mjs';
import { getMergeUsageMessage, getTargetFoundText, parseMergeArgs, validateMergeDependabotTarget } from '../src/telegram-merge-command.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

async function test(name, fn) {
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

const GREEN_BRANCH = {
  getDefaultBranch: async () => 'main',
  checkBranchCIHealth: async () => ({ healthy: true, pending: false, failedRuns: [], pendingRuns: [], error: null }),
  waitForBranchCI: async () => ({ success: true, waitedForRuns: false, completedRuns: 0, error: null }),
  waitForCommitCI: async () => ({ success: true, status: 'no_runs' }),
};

const dependabotPr = (number, createdAt, extra = {}) => ({
  number,
  title: `chore(deps): bump package ${number}`,
  url: `https://github.com/owner/repo/pull/${number}`,
  createdAt,
  headRefName: `dependabot/npm_and_yarn/package-${number}`,
  author: { login: 'app/dependabot', is_bot: true },
  ...extra,
});

const readyItem = (number, createdAt) => ({
  pr: { number, title: `Fix issue ${number}`, url: `https://github.com/owner/repo/pull/${number}`, createdAt, author: { login: 'konard' } },
  issue: null,
  sortDate: new Date(createdAt),
});

function makeProcessor(overrides = {}) {
  const calls = [];
  const processor = new MergeQueueProcessor({
    ...GREEN_BRANCH,
    owner: 'owner',
    repo: 'repo',
    ensureReadyLabel: async () => {
      calls.push('ensureReadyLabel');
      return { success: true, created: false };
    },
    syncReadyTags: async () => {
      calls.push('syncReadyTags');
      return { synced: 0, errors: 0 };
    },
    getAllReadyPRs: async () => {
      calls.push('getAllReadyPRs');
      return [readyItem(5, '2026-10-02T00:00:00Z')];
    },
    fetchDependabotPullRequests: async () => {
      calls.push('fetchDependabotPullRequests');
      return [dependabotPr(7, '2026-10-01T00:00:00Z'), dependabotPr(9, '2026-10-03T00:00:00Z')];
    },
    ...overrides,
  });
  processor.sleep = async () => {};
  return { processor, calls };
}

console.log('\n📋 Issue #2885: Dependabot PR discovery\n');

await test('isDependabotPullRequest recognises gh CLI and REST author logins', () => {
  assert.equal(isDependabotPullRequest({ author: { login: 'app/dependabot' } }), true);
  assert.equal(isDependabotPullRequest({ author: { login: 'dependabot[bot]' } }), true);
  assert.equal(isDependabotPullRequest({ author: { login: 'konard' } }), false);
  assert.equal(isDependabotPullRequest({ author: { login: 'app/renovate' } }), false);
  assert.equal(isDependabotPullRequest({}), false);
});

await test('fetchDependabotPullRequests lists open PRs by the Dependabot app, skips drafts, oldest first', async () => {
  const commands = [];
  const exec = async cmd => {
    commands.push(cmd);
    return { stdout: JSON.stringify([dependabotPr(3, '2026-10-05T00:00:00Z'), dependabotPr(2, '2026-10-01T00:00:00Z'), dependabotPr(4, '2026-10-02T00:00:00Z', { isDraft: true }), { ...dependabotPr(6, '2026-09-01T00:00:00Z'), author: { login: 'someone' } }]) };
  };
  const prs = await fetchDependabotPullRequests('owner', 'repo', false, { exec });
  assert.equal(commands.length, 1);
  assert.match(commands[0], /gh pr list --repo owner\/repo/);
  assert.ok(commands[0].includes(`--author "${DEPENDABOT_AUTHOR}"`), commands[0]);
  assert.match(commands[0], /--state open/);
  assert.deepEqual(
    prs.map(pr => pr.number),
    [2, 3]
  );
});

await test('fetchDependabotPullRequests propagates gh errors instead of reporting an empty queue', async () => {
  await assert.rejects(
    fetchDependabotPullRequests('owner', 'repo', false, {
      exec: async () => {
        throw new Error('HTTP 401');
      },
    }),
    /HTTP 401/
  );
});

await test('mergeDependabotItems unions ready items and Dependabot PRs without duplicates, oldest first', () => {
  const items = mergeDependabotItems([readyItem(5, '2026-10-02T00:00:00Z'), { ...readyItem(7, '2026-10-01T00:00:00Z'), pr: dependabotPr(7, '2026-10-01T00:00:00Z') }], [dependabotPr(7, '2026-10-01T00:00:00Z'), dependabotPr(9, '2026-10-03T00:00:00Z')]);
  assert.deepEqual(
    items.map(item => [item.pr.number, item.dependabot]),
    [
      [7, true],
      [5, false],
      [9, true],
    ]
  );
});

console.log('\n📋 Issue #2885: merge queue initialization\n');

await test('without --dependabot the queue never looks for Dependabot PRs', async () => {
  const { processor, calls } = makeProcessor();
  const result = await processor.initialize();
  assert.equal(result.success, true);
  assert.equal(result.count, 1);
  assert.equal(calls.includes('fetchDependabotPullRequests'), false);
});

await test('--dependabot adds open Dependabot PRs to the ready queue, oldest first', async () => {
  const { processor, calls } = makeProcessor({ dependabot: true });
  const result = await processor.initialize();
  assert.equal(result.success, true);
  assert.equal(result.count, 3);
  assert.equal(result.dependabotCount, 2);
  assert.deepEqual(
    processor.items.map(item => [item.pr.number, item.isDependabot]),
    [
      [7, true],
      [5, false],
      [9, true],
    ]
  );
  assert.deepEqual(calls, ['ensureReadyLabel', 'syncReadyTags', 'getAllReadyPRs', 'fetchDependabotPullRequests']);
});

await test('Dependabot-only mode (used by /fix) does not touch the ready label or ready PRs', async () => {
  const { processor, calls } = makeProcessor({ dependabot: true, includeReadyPRs: false });
  const result = await processor.initialize();
  assert.equal(result.count, 2);
  assert.deepEqual(calls, ['fetchDependabotPullRequests']);
});

await test('empty Dependabot-only queue reports a Dependabot-specific message', async () => {
  const { processor } = makeProcessor({ dependabot: true, includeReadyPRs: false, fetchDependabotPullRequests: async () => [] });
  const result = await processor.initialize();
  assert.equal(result.success, true);
  assert.equal(result.message, 'No open Dependabot PRs found');
});

await test('empty --dependabot queue mentions both sources', async () => {
  const { processor } = makeProcessor({ dependabot: true, getAllReadyPRs: async () => [], fetchDependabotPullRequests: async () => [] });
  const result = await processor.initialize();
  assert.equal(result.message, "No PRs with 'ready' label or open Dependabot PRs found");
});

await test('a Dependabot listing failure fails initialization instead of reporting nothing to merge', async () => {
  const { processor } = makeProcessor({
    dependabot: true,
    fetchDependabotPullRequests: async () => {
      throw new Error('HTTP 502');
    },
  });
  const result = await processor.initialize();
  assert.equal(result.success, false);
  assert.match(result.error, /HTTP 502/);
});

console.log('\n📋 Issue #2885: merging and auto-resolving Dependabot PRs\n');

function makeRunProcessor({ autoResolve, ciFailures, spawned, prStates = {} }) {
  const merged = [];
  return {
    merged,
    ...makeProcessor({
      dependabot: true,
      autoResolve,
      spawnSolveSession: async target => {
        spawned.push(target.prNumber);
        return { success: true, sessionName: `solve-${target.prNumber}` };
      },
      checkPRMergeable: async () => ({ mergeable: true, reason: null }),
      checkPRCIStatus: async (owner, repo, prNumber) => ({ status: ciFailures.includes(prNumber) ? 'failure' : 'success', checks: [] }),
      mergePullRequest: async (owner, repo, prNumber) => {
        merged.push(prNumber);
        return { success: true };
      },
      getMergeCommitSha: async () => ({ sha: 'abc1234567890' }),
      closeLinkedIssueIfNotAutoClosed: async () => ({ closed: false }),
      getPRStatus: async (owner, repo, prNumber) => ({ state: prStates[prNumber] || 'MERGED', mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE', error: null }),
    }),
  };
}

await test('green Dependabot PRs are merged; a failing one is reported as CI failure', async () => {
  const spawned = [];
  const { processor, merged } = makeRunProcessor({ autoResolve: false, ciFailures: [9], spawned });
  await processor.initialize();
  const result = await processor.run();
  assert.equal(result.success, true);
  assert.deepEqual(merged, [7, 5]);
  const failing = processor.items.find(item => item.pr.number === 9);
  assert.equal(failing.status, MergeItemStatus.FAILED);
  assert.equal(failing.error, CI_FAILED_REASON);
  assert.deepEqual(spawned, []);
  assert.equal(processor.stats.merged, 2);
  assert.equal(processor.stats.failed, 1);
});

await test('--auto-resolve hands a failing Dependabot PR to /solve and moves it from failed to merged', async () => {
  const spawned = [];
  const { processor } = makeRunProcessor({ autoResolve: true, ciFailures: [9], spawned });
  await processor.initialize();
  await processor.run();
  assert.deepEqual(spawned, [9]);
  const resolved = processor.items.find(item => item.pr.number === 9);
  assert.equal(resolved.status, MergeItemStatus.MERGED);
  assert.equal(processor.stats.merged, 3);
  assert.equal(processor.stats.failed, 0);
  assert.equal(processor.stats.skipped, 0);
  assert.equal(processor.stats.autoResolved, 1);
  assert.equal(processor.getFinalReport().items.find(item => item.prNumber === 9).dependabot, true);
});

await test('--auto-resolve does not dispatch failing CI of regular ready PRs (unchanged behaviour)', async () => {
  const spawned = [];
  const { processor } = makeRunProcessor({ autoResolve: true, ciFailures: [5], spawned });
  await processor.initialize();
  await processor.run();
  assert.deepEqual(spawned, []);
  assert.equal(processor.items.find(item => item.pr.number === 5).status, MergeItemStatus.FAILED);
  assert.equal(processor.stats.failed, 1);
});

await test('conflict skips and failing Dependabot PRs are resolved together, in queue order', () => {
  const { processor } = makeProcessor({ dependabot: true });
  processor.items = [
    { pr: { number: 1 }, status: MergeItemStatus.FAILED, error: CI_FAILED_REASON, isDependabot: true },
    { pr: { number: 2 }, status: MergeItemStatus.SKIPPED, error: MERGE_CONFLICT_SKIP_REASON, isDependabot: false },
    { pr: { number: 3 }, status: MergeItemStatus.FAILED, error: CI_FAILED_REASON, isDependabot: false },
    { pr: { number: 4 }, status: MergeItemStatus.FAILED, error: 'PR is blocked', isDependabot: true },
  ];
  assert.deepEqual(
    processor.getAutoResolveItems().map(item => item.pr.number),
    [1, 2]
  );
  assert.deepEqual(
    processor.getConflictedItems().map(item => item.pr.number),
    [2]
  );
});

console.log('\n📋 Issue #2885: Telegram /merge --dependabot\n');

await test('parseMergeArgs reads --dependabot next to --auto-resolve', () => {
  const { positionals, flags } = parseMergeArgs(['https://github.com/owner/repo', '--dependabot', '--auto-resolve']);
  assert.deepEqual(positionals, ['https://github.com/owner/repo']);
  assert.equal(flags.dependabot, true);
  assert.equal(flags['auto-resolve'], true);
  assert.equal(parseMergeArgs(['--dependabot=false']).flags.dependabot, false);
});

await test('--dependabot is rejected for issue and pull request targets', () => {
  assert.equal(validateMergeDependabotTarget({ mode: 'repository' }, true), null);
  assert.equal(validateMergeDependabotTarget({ mode: 'pull' }, false), null);
  assert.match(validateMergeDependabotTarget({ mode: 'pull' }, true), /repository targets/);
  assert.match(validateMergeDependabotTarget({ mode: 'issue' }, true), /repository targets/);
});

await test('found-text and usage mention Dependabot', () => {
  assert.equal(getTargetFoundText({ mode: 'repository' }, 3, { dependabot: true, dependabotCount: 2 }), "Found 3 PRs to merge \\(1 with 'ready' label, 2 from Dependabot\\)\\.");
  assert.equal(getTargetFoundText({ mode: 'repository' }, 3), "Found 3 PRs with 'ready' label\\.");
  assert.match(getMergeUsageMessage(), /\[--dependabot\]/);
});

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Test Results: ${testsPassed} passed, ${testsFailed} failed\n`);

if (testsFailed > 0) {
  process.exit(1);
}
