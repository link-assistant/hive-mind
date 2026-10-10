#!/usr/bin/env node
/**
 * Issue #2925: "⚠️ Error: Error: Cannot start merge queue: CI on main is still
 * running after waiting (Checks and release); cannot confirm main is green.
 * Please run /merge again once CI finishes."
 *
 * Replays the production timeline (docs/case-studies/issue-2925): `/merge` for
 * one ready PR (#2802) while main HEAD fdff413's "Checks and release" run sat
 * `queued` behind congested runners. The 45-minute wait timed out, and the run
 * later failed. The queue must:
 *   - stop and show every planned merge as ⏭️ skipped (not ⏳ pending);
 *   - say that CI/CD on the default branch must be fixed first for /merge to work;
 *   - not print "Error: Error:";
 *   - with `--auto-fix-ci-cd`, start `/fix --ci-cd <repository>` on a red main.
 * It also covers `/solve --fix-ci-cd` and its aliases (`/codex`, `/claude`, …).
 *
 * Run with: node tests/test-merge-blocked-by-main-ci-2925.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2925
 */

import assert from 'node:assert/strict';
import { MergeQueueProcessor, MergeStatus, MergeItemStatus } from '../src/telegram-merge-queue.lib.mjs';
import { buildBranchBlockedMessage, skipRemainingItems } from '../src/telegram-merge-blocked-branch.lib.mjs';
import { formatUserError, parseMergeArgs, spawnFixCiCdSession } from '../src/telegram-merge-command.lib.mjs';
import { buildFixCiCdArgsFromSolve, extractFixCiCdFlag, registerFixCommand } from '../src/telegram-fix-command.lib.mjs';
import { applySolveToolAlias, parseCommandArgs, SOLVE_COMMAND_NAMES, getSolveToolAliasFromText } from '../src/telegram-solve-command.lib.mjs';

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

const REPO_URL = 'https://github.com/link-assistant/hive-mind';
const RUN_URL = 'https://github.com/link-assistant/hive-mind/actions/runs/37983302098';
const QUEUED_RUN = { id: 37983302098, name: 'Checks and release', status: 'queued', conclusion: null, html_url: RUN_URL, created_at: '2026-10-09T19:53:31Z' };
const FAILED_RUN = { ...QUEUED_RUN, status: 'completed', conclusion: 'failure' };

const pending = () => ({ healthy: true, pending: true, failedRuns: [], pendingRuns: [QUEUED_RUN], error: null });
const healthy = () => ({ healthy: true, pending: false, failedRuns: [], pendingRuns: [], error: null });
const red = () => ({ healthy: false, pending: false, failedRuns: [FAILED_RUN], pendingRuns: [], error: '1 CI run(s) failed on main: Checks and release' });
const TIMEOUT = { success: false, waitedForRuns: true, completedRuns: 2, error: 'Timeout waiting for 1 CI runs on main branch' };

async function buildProcessor({ healthSequence, branchWaitSequence = [{ success: true, waitedForRuns: false, completedRuns: 0, error: null }], commitCI = { success: true, status: 'success', runs: [], failedRuns: [], error: null }, prNumbers = [2802], ...options }) {
  const calls = { merged: [], errors: [], health: 0, branchWait: 0, fixSpawns: [] };
  const next = (seq, i) => seq[Math.min(i, seq.length - 1)];
  const processor = new MergeQueueProcessor({
    owner: 'link-assistant',
    repo: 'hive-mind',
    onError: async error => calls.errors.push(error),
    ensureReadyLabel: async () => ({ success: true, created: false }),
    syncReadyTags: async () => ({ synced: 0, errors: 0 }),
    getAllReadyPRs: async () => prNumbers.map(number => ({ pr: { number, title: `PR ${number}`, url: `${REPO_URL}/pull/${number}`, createdAt: new Date().toISOString() }, issue: null })),
    getDefaultBranch: async () => 'main',
    checkBranchCIHealth: async () => next(healthSequence, calls.health++)(),
    waitForBranchCI: async () => next(branchWaitSequence, calls.branchWait++),
    waitForCommitCI: async () => commitCI,
    checkPRMergeable: async () => ({ mergeable: true }),
    checkPRCIStatus: async () => ({ status: 'success', checks: [] }),
    mergePullRequest: async (owner, repo, number) => {
      calls.merged.push(number);
      return { success: true };
    },
    closeLinkedIssueIfNotAutoClosed: async () => ({ closed: false }),
    getMergeCommitSha: async (owner, repo, number) => ({ sha: `${number}abcdef0`, error: null }),
    ...options,
  });
  processor.sleep = async () => ({ cancelled: processor.isCancelled });
  const init = await processor.initialize();
  assert.equal(init.success, true, 'initialize should succeed');
  return { processor, calls };
}

console.log('\n📋 Issue #2925: /merge on a main whose CI/CD is not green\n');

await asyncTest('Production replay: main CI still queued after the wait → PR #2802 is skipped, not left pending', async () => {
  const { processor, calls } = await buildProcessor({ healthSequence: [pending], branchWaitSequence: [TIMEOUT] });
  const result = await processor.run();
  assert.deepEqual(calls.merged, []);
  assert.equal(result.success, false);
  assert.equal(processor.status, MergeStatus.FAILED);
  assert.equal(processor.items[0].status, MergeItemStatus.SKIPPED, 'the planned merge must be shown as skipped');
  assert.equal(processor.stats.skipped, 1, 'Skipped counter must count it');
  assert.match(processor.items[0].error, /CI\/CD on main/);
  assert.match(result.error, /CI\/CD on the default branch main did not finish/);
  assert.match(result.error, /cannot be confirmed green/);
  assert.match(result.error, /Checks and release \(queued\)/, 'the message should show the run is still queued');
  assert.match(result.error, /must be fixed first/);
  assert.match(result.error, /\/fix --ci-cd https:\/\/github\.com\/link-assistant\/hive-mind/);
});

await asyncTest('Final report shows ⏭️ for the skipped PR, the Skipped count and the pending run link', async () => {
  const { processor } = await buildProcessor({ healthSequence: [pending], branchWaitSequence: [TIMEOUT], prNumbers: [2802, 2803] });
  await processor.run();
  const message = processor.formatFinalMessage();
  assert.match(message, /⏭️ Skipped: 2/);
  assert.doesNotMatch(message, /⏳ \[/, 'no PR may be rendered as still pending');
  assert.match(message, /Branch CI not finished/);
  assert.ok(message.includes(`[View](${RUN_URL})`), 'pending run should link to its GitHub Actions page');
});

await asyncTest('Red main → all planned merges skipped with "CI/CD on main must be fixed first"', async () => {
  const { processor, calls } = await buildProcessor({ healthSequence: [red], prNumbers: [2802, 2803, 2804] });
  const result = await processor.run();
  assert.deepEqual(calls.merged, []);
  assert.ok(processor.items.every(item => item.status === MergeItemStatus.SKIPPED));
  assert.ok(processor.items.every(item => item.error === 'CI/CD on main must be fixed first'));
  assert.equal(processor.stats.skipped, 3);
  assert.match(result.error, /^Cannot start merge queue: CI\/CD on the default branch main is failing \(1 CI run\(s\) failed on main: Checks and release\)\./);
  assert.match(result.error, /CI\/CD on the default branch must be fixed first for \/merge to work/);
  assert.match(result.error, /All 3 planned merges were skipped/);
  assert.match(result.error, /--auto-fix-ci-cd/, 'should mention the automatic option');
  assert.equal(calls.errors.length, 1);
  assert.equal(calls.errors[0].userFacing, true, 'onError receives a user-facing error');
});

await asyncTest('Main turns red between PRs → the rest are skipped and the message names the PR it stopped at', async () => {
  const { processor, calls } = await buildProcessor({ healthSequence: [healthy, red], prNumbers: [2802, 2803, 2804] });
  const result = await processor.run();
  assert.deepEqual(calls.merged, [2802]);
  assert.deepEqual(
    processor.items.map(item => item.status),
    [MergeItemStatus.MERGED, MergeItemStatus.SKIPPED, MergeItemStatus.SKIPPED]
  );
  assert.equal(processor.stats.skipped, 2);
  assert.match(result.error, /^Merge queue stopped before PR #2803: /);
});

await asyncTest('Post-merge CI failure → the remaining PRs are skipped too', async () => {
  const { processor, calls } = await buildProcessor({
    healthSequence: [healthy],
    prNumbers: [2802, 2803, 2804],
    commitCI: { success: false, status: 'failure', runs: [FAILED_RUN], failedRuns: [FAILED_RUN], error: '1 CI run(s) failed' },
  });
  const result = await processor.run();
  assert.deepEqual(calls.merged, [2802]);
  assert.deepEqual(
    processor.items.slice(1).map(item => item.status),
    [MergeItemStatus.SKIPPED, MergeItemStatus.SKIPPED]
  );
  assert.equal(processor.items[1].error, 'post-merge CI of #2802 failed');
  assert.match(result.error, /must be fixed first for \/merge to work/);
});

await asyncTest('--auto-fix-ci-cd on a red main starts /fix --ci-cd once and reports the session', async () => {
  const fixSpawns = [];
  const { processor } = await buildProcessor({
    healthSequence: [red],
    autoFixCiCd: true,
    spawnFixCiCdSession: async target => {
      fixSpawns.push(target);
      return { success: true, sessionName: 'fix-session-1', error: null, warning: null };
    },
  });
  const result = await processor.run();
  assert.equal(fixSpawns.length, 1);
  assert.deepEqual(fixSpawns[0], { owner: 'link-assistant', repo: 'hive-mind', url: REPO_URL, branch: 'main' });
  assert.match(result.error, /Started \/fix --ci-cd https:\/\/github\.com\/link-assistant\/hive-mind \(session fix-session-1\)/);
  assert.match(processor.formatFinalMessage(), /🛠️ \/fix \\-\\-ci\\-cd started: fix\\-session\\-1/);
});

await asyncTest('--auto-fix-ci-cd does not start /fix while main CI is only unconfirmed (pending)', async () => {
  let spawned = 0;
  const { processor } = await buildProcessor({ healthSequence: [pending], branchWaitSequence: [TIMEOUT], autoFixCiCd: true, spawnFixCiCdSession: async () => (spawned++, { success: true }) });
  await processor.run();
  assert.equal(spawned, 0);
});

await asyncTest('--auto-fix-ci-cd spawn failure → message tells the user to run /fix --ci-cd manually', async () => {
  const { processor } = await buildProcessor({ healthSequence: [red], autoFixCiCd: true, spawnFixCiCdSession: async () => ({ success: false, sessionName: null, error: 'start-screen not found' }) });
  const result = await processor.run();
  assert.match(result.error, /--auto-fix-ci-cd could not start \/fix --ci-cd .* \(start-screen not found\); run it manually/);
  assert.match(processor.formatFinalMessage(), /⚠️ \/fix \\-\\-ci\\-cd not started/);
});

await asyncTest('Without --auto-fix-ci-cd no /fix session is started', async () => {
  let spawned = 0;
  const { processor } = await buildProcessor({ healthSequence: [red], spawnFixCiCdSession: async () => (spawned++, { success: true }) });
  await processor.run();
  assert.equal(spawned, 0);
});

await asyncTest('formatUserError: no "Error: Error:" and queue messages are shown even without --verbose', async () => {
  const { processor, calls } = await buildProcessor({ healthSequence: [red] });
  await processor.run();
  const shown = formatUserError(calls.errors[0], false);
  assert.match(shown, /^Cannot start merge queue: CI\/CD on the default branch main is failing/);
  assert.equal(formatUserError(calls.errors[0], true), shown);
  assert.equal(formatUserError(new Error('boom'), true), 'boom', 'verbose mode must not add a second "Error:" label');
  assert.match(formatUserError(new Error('boom'), false), /An error occurred/);
});

await asyncTest('buildBranchBlockedMessage / skipRemainingItems unit behaviour', () => {
  const message = buildBranchBlockedMessage({ prefix: 'Cannot start merge queue', gate: { status: 'failed', branch: 'master', error: 'x failed' }, skipped: 1, repoUrl: REPO_URL });
  assert.match(message, /default branch master is failing \(x failed\)/);
  assert.match(message, /All 1 planned merge was skipped/);
  const processor = { items: [{ status: 'merged' }, { status: 'pending' }, { status: 'failed' }, { status: 'pending' }], stats: { skipped: 0 } };
  assert.equal(skipRemainingItems(processor, 1, 'why'), 2);
  assert.deepEqual(
    processor.items.map(item => item.status),
    ['merged', 'skipped', 'failed', 'skipped']
  );
  assert.equal(processor.stats.skipped, 2);
});

await asyncTest('/merge parses --auto-fix-ci-cd next to the repository URL', () => {
  const { positionals, flags } = parseMergeArgs(parseCommandArgs(`/merge ${REPO_URL} --auto-fix-ci-cd --auto-resolve`));
  assert.deepEqual(positionals, [REPO_URL]);
  assert.equal(flags['auto-fix-ci-cd'], true);
  assert.equal(flags['auto-resolve'], true);
});

await asyncTest('spawnFixCiCdSession runs `fix <repository> --ci-cd` in a work session', async () => {
  const spawned = [];
  const result = await spawnFixCiCdSession({ url: REPO_URL }, false, {
    executeStartScreen: async (command, args) => {
      spawned.push({ command, args });
      return { success: true, output: 'session: fix-abc123' };
    },
  });
  assert.deepEqual(spawned, [{ command: 'fix', args: [REPO_URL, '--ci-cd'] }]);
  assert.deepEqual(result, { success: true, sessionName: 'fix-abc123', error: null, warning: null });
  const missing = await spawnFixCiCdSession({}, false, { executeStartScreen: async () => assert.fail('must not spawn') });
  assert.equal(missing.success, false);
});

console.log('\n📋 Issue #2925: /solve --fix-ci-cd and every solve alias\n');

await asyncTest('extractFixCiCdFlag strips the flag so solve never sees an unknown option', () => {
  assert.deepEqual(extractFixCiCdFlag([REPO_URL, '--fix-ci-cd', '--model', 'opus']), { requested: true, args: [REPO_URL, '--model', 'opus'] });
  assert.deepEqual(extractFixCiCdFlag([REPO_URL, '--fix-ci-cd=false']), { requested: false, args: [REPO_URL] });
  assert.deepEqual(extractFixCiCdFlag([REPO_URL, '--no-fix-ci-cd']), { requested: false, args: [REPO_URL] });
  assert.deepEqual(extractFixCiCdFlag([REPO_URL]), { requested: false, args: [REPO_URL] });
});

await asyncTest('repository, /issues listing and owner/repo shorthand all map to /fix --ci-cd', () => {
  for (const target of [REPO_URL, `${REPO_URL}/`, `${REPO_URL}/issues`, `${REPO_URL}/issues/`, `${REPO_URL}/issues?q=is%3Aopen`, `${REPO_URL}/actions`, 'link-assistant/hive-mind']) {
    const built = buildFixCiCdArgsFromSolve([target, '--model', 'opus']);
    assert.ok(!built.error, `${target}: ${built.error}`);
    assert.deepEqual(built.args, [REPO_URL, '--model', 'opus', '--ci-cd'], target);
  }
});

await asyncTest('a specific issue or pull request is rejected with an explanation', () => {
  for (const target of [`${REPO_URL}/issues/2925`, `${REPO_URL}/pull/3012`]) {
    const built = buildFixCiCdArgsFromSolve([target]);
    assert.match(built.error, /works on a whole repository/, target);
  }
  assert.match(buildFixCiCdArgsFromSolve(['--model', 'opus']).error, /needs a GitHub repository link/);
  // An option value that looks like owner/repo is not mistaken for the target.
  assert.match(buildFixCiCdArgsFromSolve(['--base-branch', 'feature/x']).error, /needs a GitHub repository link/);
});

await asyncTest('every solve alias keeps its tool when routed to /fix --ci-cd', () => {
  for (const command of SOLVE_COMMAND_NAMES) {
    const text = `/${command} ${REPO_URL}/issues --fix-ci-cd`;
    const { args } = extractFixCiCdFlag(parseCommandArgs(text));
    const alias = getSolveToolAliasFromText(text);
    const built = buildFixCiCdArgsFromSolve(applySolveToolAlias(args, alias));
    assert.equal(built.args[0], REPO_URL, command);
    assert.ok(built.args.includes('--ci-cd'), command);
    if (alias) assert.deepEqual(built.args.slice(built.args.indexOf('--tool'), built.args.indexOf('--tool') + 2), ['--tool', alias], command);
  }
});

function buildFixHarness(overrides = {}) {
  const calls = { executed: [], replies: [] };
  const { handleFixCiCdFromSolve } = registerFixCommand(
    { command() {} },
    {
      VERBOSE: false,
      fixEnabled: true,
      addBreadcrumb: async () => {},
      isOldMessage: () => false,
      isForwardedOrReply: () => false,
      isGroupChat: () => true,
      isTopicAuthorized: () => true,
      buildAuthErrorMessage: () => 'not authorized',
      isChatStopped: () => false,
      getStoppedChatRejectMessage: () => 'stopped',
      safeReply: async (_ctx, text) => {
        calls.replies.push(text);
        return { chat: { id: 100 }, message_id: 301 };
      },
      executeAndUpdateMessage: async (ctx, message, commandName, args, infoBlock, isolation, tool) => calls.executed.push({ commandName, args, tool }),
      ...overrides,
    }
  );
  const ctx = { chat: { id: 100, type: 'group' }, from: { id: 200, username: 'tester' }, message: { message_id: 300 } };
  return { handleFixCiCdFromSolve, calls, ctx };
}

await asyncTest('/codex <repo>/issues --fix-ci-cd starts the same session as /fix --ci-cd --tool codex', async () => {
  const { handleFixCiCdFromSolve, calls, ctx } = buildFixHarness();
  await handleFixCiCdFromSolve(ctx, [`${REPO_URL}/issues`, '--tool', 'codex'], { commandDisplay: '/codex' });
  assert.deepEqual(calls.replies.slice(1), []);
  assert.equal(calls.executed.length, 1, `replies: ${calls.replies.join(' | ')}`);
  assert.equal(calls.executed[0].commandName, 'fix');
  assert.deepEqual(calls.executed[0].args.slice(0, 4), [REPO_URL, '--tool', 'codex', '--ci-cd']);
  assert.equal(calls.executed[0].tool, 'codex');
});

await asyncTest('--fix-ci-cd with a specific issue replies with an error and starts nothing', async () => {
  const { handleFixCiCdFromSolve, calls, ctx } = buildFixHarness();
  await handleFixCiCdFromSolve(ctx, [`${REPO_URL}/issues/2925`]);
  assert.equal(calls.executed.length, 0);
  assert.match(calls.replies[0], /works on a whole repository/);
});

await asyncTest('--fix-ci-cd respects a disabled /fix command', async () => {
  const { handleFixCiCdFromSolve, calls, ctx } = buildFixHarness({ fixEnabled: false });
  await handleFixCiCdFromSolve(ctx, [REPO_URL]);
  assert.equal(calls.executed.length, 0);
  assert.match(calls.replies[0], /disabled/);
});

console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed\n`);
if (testsFailed > 0) process.exit(1);
