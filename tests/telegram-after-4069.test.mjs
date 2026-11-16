#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #4069: `/after` and `/enqueue` start one task after another task, found
 * as `/stop`, `/log` and `/watch` find it; `/after` starts it only when the
 * awaited task succeeds. `--respect-blockers` makes a solve task wait for (or
 * refuse to start before) its open GitHub blockers and sub-issues, and a
 * multi-link batch starts its unblocked links first.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4069
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseGitHubUrl } from '../src/github.lib.mjs';
import { normalizeIssueRelations } from '../src/hive.issue-relations.lib.mjs';
import { initI18n, t } from '../src/i18n.lib.mjs';
import { mentionsGitHubHost } from '../src/telegram-message-filters.lib.mjs';
import { cleanNonPrintableChars } from '../src/telegram-markdown.lib.mjs';
import { parseCommandArgs } from '../src/telegram-solve-command.lib.mjs';
import { AFTER_COMMAND_NAMES, getDependencyCommandMode, isAwaitedTaskUrl, parseDependencyCommand, planSolveLaunchWait, resolveDependencyLaunch } from '../src/telegram-after-command.lib.mjs';
import { classifyDependencyOutcome, createItemTarget, createSessionTarget, DEPENDENCY_MODE, resolveDependencyTarget, SolveDependencyTracker } from '../src/telegram-solve-dependencies.lib.mjs';
import { collectBlockerUrls, extractRespectBlockersFlag, orderBatchByBlockers, planBlockerWait, prepareBatchBlockers } from '../src/telegram-solve-blockers.lib.mjs';
import { SolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { buildSolveWaitingForTasksMessage } from '../src/telegram-ui-messages.lib.mjs';

await initI18n('en');

const deps = { parseGitHubUrl, cleanNonPrintableChars, mentionsGitHubHost };
const tr = (key, params) => t(key, params, { locale: 'en' });
const UUID = '2b7d3c1e-4f5a-4b6c-8d9e-0a1b2c3d4e5f';
const A = 'https://github.com/o/r/issues/1';
const B = 'https://github.com/o/r/issues/2';
const C = 'https://github.com/o/r/issues/3';

function newQueue(isSessionActive = () => false) {
  const queue = new SolveQueue({ verbose: false, autoStart: false, isSessionActive });
  queue.log = () => {};
  return queue;
}

/** A tiny graph for o/r: { 1: { parent: 2, blockedBy: [3], state: 'CLOSED' } } → relations map. */
function relationsOf(spec) {
  const all = new Map(Object.keys(spec).map(n => [Number(n), { parent: null, blockedBy: [], state: 'OPEN', ...spec[n] }]));
  const url = n => `https://github.com/o/r/issues/${n}`;
  const ref = n => ({ url: url(n), state: all.get(n)?.state ?? 'OPEN' });
  const relations = new Map();
  for (const [n, item] of all) {
    const subs = [...all].filter(([, other]) => other.parent === n).map(([m]) => m);
    const blocking = [...all].filter(([, other]) => other.blockedBy.includes(n)).map(([m]) => m);
    const relation = normalizeIssueRelations({ url: url(n), state: item.state, stateReason: null, parent: item.parent ? ref(item.parent) : null, subIssues: { nodes: subs.map(ref) }, blockedBy: { nodes: item.blockedBy.map(ref) }, blocking: { nodes: blocking.map(ref) } });
    relations.set(relation.key, relation);
  }
  return relations;
}

// --- Commands ---------------------------------------------------------------

test('/after needs success and /enqueue only needs the task to finish', () => {
  assert.deepEqual([...AFTER_COMMAND_NAMES].sort(), ['after', 'enqueue']);
  assert.equal(getDependencyCommandMode('/after'), DEPENDENCY_MODE.SUCCESS);
  assert.equal(getDependencyCommandMode('/enqueue@hive_bot'), DEPENDENCY_MODE.FINISH);
  assert.equal(getDependencyCommandMode('solve'), null);
});

test('a reply names the awaited task; the command names the task to start', () => {
  const parsed = parseDependencyCommand({ userArgs: parseCommandArgs(`/after ${B} --model opus`), replyMessage: { text: `🚀 Started ${A}\nSession: ${UUID}` }, deps });
  assert.deepEqual(parsed, { ok: true, target: { kind: 'uuid', value: UUID, source: 'reply' }, taskUrl: B, optionArgs: ['--model', 'opus'] });
  const byUrl = parseDependencyCommand({ userArgs: [], replyMessage: { text: `Queued ${A}` }, deps });
  assert.deepEqual(byUrl, { ok: true, target: { kind: 'url', value: A, source: 'reply' }, taskUrl: null, optionArgs: [] });
});

test('the command arguments win over the reply, as in /stop', () => {
  const uuid = parseDependencyCommand({ userArgs: [UUID.toUpperCase(), B], replyMessage: { text: A }, deps });
  assert.deepEqual(uuid.target, { kind: 'uuid', value: UUID, source: 'argument' });
  assert.equal(uuid.taskUrl, B);
  const twoLinks = parseDependencyCommand({ userArgs: [A, B, '--think', 'high'], replyMessage: null, deps });
  assert.deepEqual(twoLinks.target, { kind: 'url', value: A, source: 'argument' });
  assert.equal(twoLinks.taskUrl, B);
  assert.deepEqual(twoLinks.optionArgs, ['--think', 'high']);
});

test('one task per command: no target, many tasks or a bad link are refused', () => {
  assert.deepEqual(parseDependencyCommand({ userArgs: [B], replyMessage: null, deps }), { ok: false, error: 'no-target' });
  assert.equal(parseDependencyCommand({ userArgs: [A, B, C], replyMessage: null, deps }).error, 'many-tasks');
  assert.equal(parseDependencyCommand({ userArgs: [UUID, UUID.replace('2b', '3c')], replyMessage: null, deps }).error, 'many-tasks');
  assert.equal(parseDependencyCommand({ userArgs: ['https://github.com/o/r/wiki/x'], replyMessage: { text: A }, deps }).error, 'invalid-link');
});

// --- Tracker ----------------------------------------------------------------

test('dependency outcomes: no changes is a success, kills and failures are not', () => {
  assert.equal(classifyDependencyOutcome({ exitCode: 0, status: 'executed' }).succeeded, true);
  assert.equal(classifyDependencyOutcome({ exitCode: 1, status: 'executed' }).succeeded, false);
  assert.equal(classifyDependencyOutcome({ exitCode: 137, status: 'killed' }).succeeded, false);
});

function trackerWith({ active = new Set(), now = () => 0, missingGraceMs = 1000 } = {}) {
  const released = [];
  const failed = [];
  const tracker = new SolveDependencyTracker({ isSessionActive: names => [...names].some(name => active.has(name)), onRelease: (entry, summary) => released.push({ id: entry.item.id, summary }), onFail: (entry, reason) => failed.push({ id: entry.item.id, reason }), now, missingGraceMs });
  return { tracker, released, failed };
}

test('success mode releases on success and fails when the awaited task fails', async () => {
  const active = new Set(['s1', 's2']);
  const { tracker, released, failed } = trackerWith({ active });
  tracker.add({ id: 'ok', url: B }, { targets: [createSessionTarget({ names: ['s1'], url: A })], mode: DEPENDENCY_MODE.SUCCESS });
  tracker.add({ id: 'ko', url: C }, { targets: [createSessionTarget({ names: ['s2'], url: A })], mode: DEPENDENCY_MODE.SUCCESS });
  assert.deepEqual(await tracker.reconcile(), { released: [], failed: [] });
  tracker.handleSessionCompletion({ sessionName: 's1', exitCode: 0, status: 'executed' });
  tracker.handleSessionCompletion({ sessionName: 's2', exitCode: 1, status: 'executed' });
  await tracker.reconcile();
  assert.deepEqual(
    released.map(entry => entry.id),
    ['ok']
  );
  assert.deepEqual(
    failed.map(entry => entry.id),
    ['ko']
  );
  assert.match(failed[0].reason, /failed \(exit code 1\)/);
  assert.equal(tracker.size, 0);
});

test('finish mode starts after a failure, but a per-target success requirement still fails it', async () => {
  const { tracker, released, failed } = trackerWith({ active: new Set(['s1', 's2']) });
  tracker.add({ id: 'enqueue', url: B }, { targets: [createSessionTarget({ names: ['s1'] })], mode: DEPENDENCY_MODE.FINISH });
  tracker.add({ id: 'blocked', url: C }, { targets: [createSessionTarget({ names: ['s1'] }), { ...createSessionTarget({ names: ['s2'] }), mode: DEPENDENCY_MODE.SUCCESS }], mode: DEPENDENCY_MODE.FINISH });
  tracker.handleSessionCompletion({ sessionName: 's1', exitCode: 1, status: 'executed' });
  tracker.handleSessionCompletion({ sessionName: 's2', exitCode: 1, status: 'executed' });
  await tracker.reconcile();
  assert.deepEqual(
    released.map(entry => entry.id),
    ['enqueue']
  );
  assert.deepEqual(
    failed.map(entry => entry.id),
    ['blocked']
  );
});

test('a session continued by kill recovery is not finished; a lost session fails after the grace period', async () => {
  let clock = 0;
  const active = new Set(['s1']);
  const { tracker, released, failed } = trackerWith({ active, now: () => clock, missingGraceMs: 1000 });
  tracker.add({ id: 'x', url: B }, { targets: [createSessionTarget({ names: ['s1'] })] });
  tracker.handleSessionCompletion({ sessionName: 's1', exitCode: 137, status: 'killed', supersededBy: 's1-recovery' });
  await tracker.reconcile();
  assert.equal(tracker.size, 1);
  active.delete('s1');
  await tracker.reconcile();
  assert.equal(tracker.size, 1, 'still within the grace period');
  clock = 1000;
  await tracker.reconcile();
  assert.deepEqual(released, []);
  assert.equal(failed.length, 1);
  assert.match(failed[0].reason, /ended without a known result/);
});

test('a failed chain fails in one recheck', async () => {
  const { tracker, failed } = trackerWith({ active: new Set(['s1']) });
  const first = { id: 'first', url: B };
  tracker.add(first, { targets: [createSessionTarget({ names: ['s1'] })] });
  tracker.add({ id: 'second', url: C }, { targets: [createItemTarget(first)] });
  tracker.handleSessionCompletion({ sessionName: 's1', exitCode: 2, status: 'executed' });
  first.status = 'failed';
  await tracker.reconcile();
  assert.deepEqual(
    failed.map(entry => entry.id),
    ['first', 'second']
  );
});

// --- Queue ------------------------------------------------------------------

test('a waiting item joins its tool queue when the awaited queue item succeeds', async () => {
  const queue = newQueue();
  const first = queue.enqueue({ url: A, args: [A], requester: 'u', infoBlock: 'A', tool: 'claude' });
  const second = queue.enqueueAfter({ url: B, args: [B], requester: 'u', infoBlock: 'B', tool: 'codex', waitingReason: 'after A' }, { targets: [createItemTarget(first)], mode: DEPENDENCY_MODE.SUCCESS });
  assert.equal(second.status, 'waiting');
  assert.equal(queue.findByUrl(B), second);
  assert.equal(queue.getToolQueue('codex').length, 0);
  assert.match(await queue.formatDetailedStatus(), /Waiting for other tasks \(1\)/);
  assert.equal(queue.findLaunchConflict(B), second, 'a second task for B duplicates the waiting one');
  assert.equal(queue.findLaunchConflict(A, [createItemTarget(first)]), null, '/after may run A again after A');
  // A starts and its session ends successfully.
  first.status = 'started';
  first.sessionName = 'solve-a';
  queue.queues.claude.splice(0);
  queue.completed.push(first);
  queue.recordSessionCompletion({ sessionName: 'solve-a', url: A, tool: 'claude', exitCode: 0, status: 'executed' });
  await queue.reconcileDependencies();
  assert.equal(second.status, 'queued');
  assert.deepEqual(queue.getToolQueue('codex'), [second]);
  assert.match(second.dependencySummary, /finished successfully/);
  queue.dependencies.stop();
});

test('cancelling the awaited item fails an /after task and releases an /enqueue task', async () => {
  const queue = newQueue();
  const first = queue.enqueue({ url: A, args: [A], requester: 'u', infoBlock: 'A', tool: 'claude' });
  const after = queue.enqueueAfter({ url: B, args: [B], requester: 'u', infoBlock: 'B', tool: 'claude' }, { targets: [createItemTarget(first)], mode: DEPENDENCY_MODE.SUCCESS });
  const enqueued = queue.enqueueAfter({ url: C, args: [C], requester: 'u', infoBlock: 'C', tool: 'claude' }, { targets: [createItemTarget(first)], mode: DEPENDENCY_MODE.FINISH });
  assert.equal(queue.cancel(first.id), true);
  await queue.reconcileDependencies();
  assert.equal(after.status, 'failed');
  assert.match(after.error, /cancelled/);
  assert.equal(enqueued.status, 'queued');
  assert.equal(queue.cancel(enqueued.id), true, 'a released task is an ordinary queued one');
  queue.dependencies.stop();
});

test('a waiting item can be cancelled before it starts', () => {
  const queue = newQueue(() => true);
  const waiting = queue.enqueueAfter({ url: B, args: [B], requester: 'u', infoBlock: 'B' }, { targets: [createSessionTarget({ names: ['s1'] })], mode: DEPENDENCY_MODE.SUCCESS });
  assert.equal(queue.cancel(waiting.id), true);
  assert.equal(waiting.status, 'cancelled');
  assert.equal(queue.dependencies.size, 0);
  queue.dependencies.stop();
});

// --- Resolving the awaited task ---------------------------------------------

test('the awaited task resolves to a queue item, a running session, a finished task or nothing', () => {
  const queue = newQueue();
  const item = queue.enqueue({ url: A, args: [A], requester: 'u', infoBlock: 'A' });
  assert.equal(resolveDependencyTarget({ kind: 'url', value: A }, { solveQueue: queue }).target.item, item);
  const session = resolveDependencyTarget({ kind: 'uuid', value: UUID }, { solveQueue: queue, findSessionById: id => (id === UUID ? { sessionName: 'solve-b', sessionInfo: { url: B, sessionId: UUID } } : null) });
  assert.equal(session.status, 'active');
  assert.equal(session.target.type, 'session');
  assert.ok(session.target.names.has('solve-b'));
  queue.cancel(item.id);
  const finished = resolveDependencyTarget({ kind: 'url', value: A }, { solveQueue: queue });
  assert.deepEqual(finished, { status: 'finished', succeeded: false, detail: 'cancelled', url: A });
  assert.deepEqual(resolveDependencyTarget({ kind: 'url', value: C }, { solveQueue: queue }), { status: 'unknown' });
});

test('resolveDependencyLaunch: waits for an active task, refuses unknown and failed ones, starts after finished ones', () => {
  const queue = newQueue();
  const item = queue.enqueue({ url: A, args: [A], requester: 'u', infoBlock: 'A' });
  const reply = { text: A };
  const parse = args => parseDependencyCommand({ userArgs: args, replyMessage: reply, deps });
  const launch = resolveDependencyLaunch({ parsed: parse([B, '--think', 'high']), mode: DEPENDENCY_MODE.SUCCESS, solveQueue: queue, tr });
  assert.equal(launch.action, 'launch');
  assert.deepEqual(launch.userArgs, [B, '--think', 'high']);
  assert.equal(launch.dependsOn.targets[0].item, item);
  const again = resolveDependencyLaunch({ parsed: parse([]), mode: DEPENDENCY_MODE.SUCCESS, solveQueue: queue, tr });
  assert.deepEqual(again.userArgs, [A], 'without a task link, the awaited link runs again');
  assert.ok(isAwaitedTaskUrl(again.dependsOn.targets, A));

  queue.cancel(item.id);
  const failed = resolveDependencyLaunch({ parsed: parse([B]), mode: DEPENDENCY_MODE.SUCCESS, solveQueue: queue, tr });
  assert.equal(failed.action, 'reply');
  assert.match(failed.text, /cancelled/);
  const enqueue = resolveDependencyLaunch({ parsed: parse([B]), mode: DEPENDENCY_MODE.FINISH, solveQueue: queue, tr });
  assert.equal(enqueue.action, 'launch');
  assert.equal(enqueue.dependsOn, null);
  assert.ok(enqueue.notice);

  const unknown = resolveDependencyLaunch({ parsed: parseDependencyCommand({ userArgs: [C, B], replyMessage: null, deps }), mode: DEPENDENCY_MODE.SUCCESS, solveQueue: queue, tr });
  assert.equal(unknown.action, 'reply');
  const usage = resolveDependencyLaunch({ parsed: { ok: false, error: 'no-target' }, mode: DEPENDENCY_MODE.SUCCESS, solveQueue: queue, tr });
  assert.equal(usage.text, tr('telegram.solve_after_usage'));
});

// --- --respect-blockers -------------------------------------------------------

test('--respect-blockers is a bot option that never reaches solve', () => {
  assert.deepEqual(extractRespectBlockersFlag([A, '--respect-blockers', '--model', 'opus']), { args: [A, '--model', 'opus'], respectBlockers: true });
  assert.equal(extractRespectBlockersFlag(['--no-respect-blockers']).respectBlockers, false);
  assert.equal(extractRespectBlockersFlag(['--respect-blockers=false']).respectBlockers, false);
  assert.equal(extractRespectBlockersFlag([A]).respectBlockers, null);
});

test('blockers and open sub-issues are what an issue waits for', () => {
  // 1 is blocked by 2; 4 is the parent of 3 (a sub-issue blocks its parent).
  const relations = relationsOf({ 1: { blockedBy: [2] }, 2: {}, 3: { parent: 4 }, 4: {} });
  assert.deepEqual(collectBlockerUrls([{ refs: [{ url: B }, { url: B }] }]), [B]);
  return Promise.all([
    planBlockerWait({ url: 'https://github.com/o/r/issues/2', relations, solveQueue: newQueue() }).then(plan => assert.equal(plan.action, 'start')),
    planBlockerWait({ url: 'https://github.com/o/r/issues/4', relations, solveQueue: newQueue() }).then(plan => {
      assert.equal(plan.action, 'reject');
      assert.deepEqual(
        plan.missing.map(entry => entry.url),
        [C]
      );
    }),
  ]);
});

test('a task whose blockers are queued waits for them; unqueued blockers keep it from starting', async () => {
  const relations = relationsOf({ 1: { blockedBy: [2] }, 2: {} });
  const queue = newQueue();
  const rejected = await planBlockerWait({ url: A, relations, solveQueue: queue });
  assert.equal(rejected.action, 'reject');
  const blocker = queue.enqueue({ url: B, args: [B], requester: 'u', infoBlock: 'B' });
  const plan = await planBlockerWait({ url: A, relations, solveQueue: queue });
  assert.equal(plan.action, 'wait');
  assert.equal(plan.targets[0].item, blocker);
  // A pull request has no blockers; unreadable relations never block work.
  assert.equal((await planBlockerWait({ url: 'https://github.com/o/r/pull/9', relations, solveQueue: queue })).action, 'start');
  const unreadable = await planBlockerWait({ url: C, fetchRelations: async () => Promise.reject(new Error('rate limited')), solveQueue: queue });
  assert.deepEqual(unreadable, { action: 'start', note: 'issue relations could not be read' });
});

test('planSolveLaunchWait combines /enqueue with blockers that must succeed', async () => {
  const queue = newQueue();
  const awaited = queue.enqueue({ url: C, args: [C], requester: 'u', infoBlock: 'C' });
  const blocker = queue.enqueue({ url: B, args: [B], requester: 'u', infoBlock: 'B' });
  const relations = relationsOf({ 1: { blockedBy: [2] }, 2: {} });
  const plan = await planSolveLaunchWait({ dependsOn: { targets: [createItemTarget(awaited)], mode: DEPENDENCY_MODE.FINISH }, respectBlockers: true, planBlockers: () => planBlockerWait({ url: A, relations, solveQueue: queue }), tr });
  assert.equal(plan.action, 'wait');
  assert.equal(plan.mode, DEPENDENCY_MODE.FINISH);
  assert.deepEqual(
    plan.targets.map(target => [target.item, target.mode]),
    [
      [awaited, undefined],
      [blocker, DEPENDENCY_MODE.SUCCESS],
    ]
  );
  assert.match(plan.waitingText, /finish/i);
  assert.equal((await planSolveLaunchWait({ respectBlockers: false, planBlockers: () => assert.fail('not read'), tr })).action, 'start');
  const reject = await planSolveLaunchWait({ respectBlockers: true, planBlockers: () => planBlockerWait({ url: A, relations, solveQueue: newQueue() }), tr });
  assert.equal(reject.action, 'reject');
  assert.ok(reject.reason.includes('o/r/issues/2'));
});

// --- Multi-link batches -------------------------------------------------------

test('a batch starts unblocked links first and each blocked link after its blockers', async () => {
  // 1 waits for 2, 2 waits for 3; 5 is a parent waiting for its sub-issue 4.
  const relations = relationsOf({ 1: { blockedBy: [2] }, 2: { blockedBy: [3] }, 3: {}, 4: { parent: 5 }, 5: {} });
  const urls = [1, 2, 3, 4, 5].map(n => `https://github.com/o/r/issues/${n}`);
  const order = orderBatchByBlockers(urls, relations);
  assert.equal(order.ready, 2);
  assert.equal(order.waiting, 3);
  const position = n => order.urls.indexOf(`https://github.com/o/r/issues/${n}`);
  assert.ok(position(3) < position(2) && position(2) < position(1));
  assert.ok(position(4) < position(5));
  assert.ok(position(3) < 2 && position(4) < 2, 'unblocked links come first');

  const prepared = await prepareBatchBlockers({ urls, fetchRelations: async () => relations });
  assert.deepEqual(prepared.urls, order.urls);
  const failing = await prepareBatchBlockers({ urls, fetchRelations: async () => Promise.reject(new Error('offline')) });
  assert.deepEqual(failing, { urls, relations: null });
  const pullsOnly = await prepareBatchBlockers({ urls: ['https://github.com/o/r/pull/7'], fetchRelations: () => assert.fail('not read') });
  assert.equal(pullsOnly.relations, null);
});

// --- Messages -----------------------------------------------------------------

test('the queued message says what the task waits for', () => {
  const text = buildSolveWaitingForTasksMessage({ locale: 'en', infoBlock: 'Requested by: u', waitingText: 'Starts after X succeeds' });
  assert.ok(text.startsWith(tr('telegram.solve_after_queued')));
  assert.ok(text.includes('Starts after X succeeds'));
  assert.ok(text.endsWith('Requested by: u'));
});
