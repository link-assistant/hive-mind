#!/usr/bin/env node
/**
 * Issue #4143: a running instance publishes its tasks and intake to the bot
 * state, operators read it with --status, drain it with --drain and wait for
 * it with --wait-for-idle; the next instance restores subscribers and the
 * queued tasks and keeps editing their Telegram messages.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { assert, asyncTest, printSummary, getFailCount } from './test-helpers.mjs';
import { createBotStateStore } from '../src/bot-state-store.lib.mjs';
import { createBotInstanceState, restoreQueuedTasks, snapshotTasks } from '../src/bot-instance-state.lib.mjs';
import { describeInstanceState, formatStatusText, runInstanceStateCommand } from '../src/bot-instance-status.lib.mjs';
import { SolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { getSubscribers, onSubscribersChanged, resetSubscribersForTests, restoreSubscribers, addSubscriber } from '../src/telegram-subscribers.lib.mjs';

process.env.HIVE_MIND_CLINK = 'off'; // .lino only; link-cli is covered by the store test
const newStore = () => createBotStateStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'hm-4143-i-')), log: () => {} });
const quiet = () => {};
const newQueue = () => new SolveQueue({ autoStart: false, isSessionActive: () => false });
const fakeTelegram = { edits: [], editMessageText: async (...args) => fakeTelegram.edits.push(args) };
const ctxFor = (chatId, userId) => ({ telegram: fakeTelegram, chat: { id: chatId }, from: { id: userId }, message: { message_id: 7, message_thread_id: 3 } });

console.log('🧪 Issue #4143: instance state, status and drain\n');

await asyncTest('snapshot lists queued, waiting and running tasks with isolation', async () => {
  const queue = newQueue();
  const first = queue.enqueue({ url: 'https://github.com/o/r/issues/1', args: ['https://github.com/o/r/issues/1', '--model', 'opus'], ctx: ctxFor(-100, 5), requester: '@a', tool: 'claude', perCommandIsolation: 'docker' });
  first.messageInfo = { chatId: -100, messageId: 70, messageThreadId: 3 };
  queue.enqueueAfter({ url: 'https://github.com/o/r/issues/2', args: ['https://github.com/o/r/issues/2'], ctx: ctxFor(-100, 5), tool: 'claude', waitingReason: 'after #1' }, { targets: [{ type: 'item', item: first, label: '#1', names: new Set() }], mode: 'success' });
  const sessions = [
    { sessionName: 'solve-1', sessionInfo: { url: 'https://github.com/o/r/issues/9', isolationBackend: 'docker', chatId: -100, launchedAt: new Date() } },
    { sessionName: 'old', sessionInfo: { url: 'x', retainedForResume: true } },
  ];
  const tasks = snapshotTasks({ queue, sessions });
  queue.stop();
  assert(Object.keys(tasks).length === 3, 'two queue items and one live session (finished session skipped)');
  assert(tasks[first.id].status === 'queued' && tasks[first.id].isolation === 'docker' && tasks[first.id].messageId === 70, 'queued item keeps isolation and its Telegram message');
  const waiting = Object.values(tasks).find(task => task.status === 'waiting');
  assert(waiting.waitsFor[0].itemId === first.id && waiting.dependencyMode === 'success', 'waiting item records what it waits for');
  assert(tasks['solve-1'].status === 'running' && tasks['solve-1'].isolation === 'docker', 'running isolated session');
});

await asyncTest('publisher: start, drain acknowledgement, gate and final write', async () => {
  const store = newStore();
  let clock = Date.parse('2026-11-25T10:00:00Z');
  const queue = newQueue();
  const sessions = [];
  const state = createBotInstanceState({ store, now: () => clock, intervalMs: 60000, heartbeatMs: 60000, log: quiet });
  await state.start({ queue, getActiveSessions: () => sessions, getSubscribers: () => [], getLaunchingCount: () => 0 });
  let read = (await store.read()).state;
  assert(read.instance.id === state.instanceId && read.instance.pid === process.pid, 'instance published');
  assert(queue.isIntakePausedFn() === false, 'queue consumer is not paused');

  sessions.push({ sessionName: 'solve-1', sessionInfo: { url: 'https://github.com/o/r/issues/9', isolationBackend: 'screen' } });
  clock += 1000;
  await state.tick();
  read = (await store.read()).state;
  assert(read.tasks['solve-1'].status === 'running', 'a new running session is published on the next tick');

  clock += 1000;
  assert((await runInstanceStateCommand({ drain: true, drainReason: 'deploy' }, { store, now: () => clock, out: quiet, err: quiet })) === 0, '--drain exits 0');
  read = (await store.read()).state;
  assert(read.intake.state === 'draining' && read.intake.instanceId === state.instanceId && !read.intake.acknowledgedAt, 'drain requested for this instance');
  clock += 1000;
  await state.tick();
  assert(state.isDraining() && queue.isIntakePausedFn() === true, 'instance drains and the queue consumer pauses');
  read = (await store.read()).state;
  assert(read.intake.acknowledgedBy === state.instanceId, 'drain acknowledged in the state');

  const chat = state.wrapChatStop({ isChatStopped: () => false, getChatStopInfo: () => null, getStoppedChatRejectMessage: () => 'stopped' });
  assert(chat.isChatStopped(1) === true, 'every chat rejects new tasks while draining');
  assert(chat.getStoppedChatRejectMessage(1, 'Solve').includes('draining') && chat.getStoppedChatRejectMessage(1, 'Solve').includes('deploy'), 'reject message explains the drain and its reason');

  const busy = describeInstanceState(read, { now: clock });
  assert(busy.instance.alive && busy.intake.acknowledged && busy.counts.running === 1 && !busy.drained, 'busy while the session runs');
  sessions.length = 0;
  clock += 1000;
  await state.tick();
  const idle = describeInstanceState((await store.read()).state, { now: clock });
  assert(idle.drained && idle.idle, 'drained once the session finished');

  clock += 1000;
  await runInstanceStateCommand({ resumeIntake: true }, { store, now: () => clock, out: quiet, err: quiet });
  await state.tick();
  assert(!state.isDraining() && chat.isChatStopped(1) === false, '--resume-intake reopens intake');

  await state.stop();
  const stopped = describeInstanceState((await store.read()).state, { now: clock });
  assert(stopped.instance.alive === false && stopped.instance.reason.startsWith('stopped at'), 'final write marks the instance stopped');
  queue.stop();
});

await asyncTest('--wait-for-idle: waits for running tasks, times out, and ignores a stopped instance', async () => {
  const store = newStore();
  let clock = Date.parse('2026-11-25T10:00:00Z');
  const now = () => clock;
  const at = () => new Date(clock).toISOString();
  await store.update(draft => {
    draft.instance = { id: 'i1', pid: process.pid, hostname: os.hostname(), startedAt: at(), heartbeatAt: at(), updatedAt: at() };
    draft.tasks = { s: { source: 'session', status: 'running', isolation: 'docker' } };
  });
  const out = [];
  const notDraining = await runInstanceStateCommand({ waitForIdle: true, json: true }, { store, now, out: text => out.push(text), err: quiet, sleepImpl: async () => {} });
  assert(notDraining === 1, 'refuses to wait without a drain');
  // The bot acknowledges and the task finishes after two polls.
  let polls = 0;
  const sleepImpl = async ms => {
    clock += ms;
    polls++;
    await store.update(draft => {
      draft.intake.acknowledgedAt = draft.intake.acknowledgedAt || at();
      draft.intake.acknowledgedBy = draft.instance.id;
      if (polls >= 2) draft.tasks = {};
      draft.instance.heartbeatAt = draft.instance.updatedAt = at();
    });
  };
  const code = await runInstanceStateCommand({ drain: true, waitForIdle: true, waitTimeout: 600, json: true }, { store, now, out: text => out.push(text), err: quiet, sleepImpl, pollMs: 1000 });
  assert(code === 0 && polls === 2, 'returns 0 once acknowledged and idle');
  assert(JSON.parse(out.at(-1)).waited === 'idle', 'JSON output reports idle');

  await store.update(draft => {
    draft.tasks = { s: { source: 'session', status: 'running' } };
    draft.instance.heartbeatAt = draft.instance.updatedAt = at();
  });
  const timeout = await runInstanceStateCommand({ waitForIdle: true, waitTimeout: 2 }, { store, now, out: quiet, err: quiet, pollMs: 1000, sleepImpl: async ms => (clock += ms) });
  assert(timeout === 1, 'returns 1 on timeout while a task still runs');

  await store.update(draft => {
    draft.instance.stoppedAt = at();
  });
  const gone = await runInstanceStateCommand({ waitForIdle: true }, { store, now, out: quiet, err: quiet, sleepImpl: async () => {} });
  assert(gone === 1, 'a stopped instance with active tasks does not prove the redeploy is safe');
  await store.update(draft => {
    draft.tasks = {};
  });
  assert((await runInstanceStateCommand({ waitForIdle: true }, { store, now, out: quiet, err: quiet })) === 0, 'a cleanly stopped and idle instance has nothing to wait for');
});

await asyncTest('status text and liveness', async () => {
  const now = Date.parse('2026-11-25T10:00:00Z');
  const state = {
    instance: { id: 'i', pid: 999999, hostname: os.hostname(), startedAt: '2026-11-25T09:00:00.000Z', heartbeatAt: '2026-11-25T09:59:58.000Z', updatedAt: '2026-11-25T09:59:58.000Z', launching: 1 },
    intake: { state: 'accepting' },
    tasks: { a: { source: 'queue', status: 'queued', command: 'solve', url: 'https://github.com/o/r/issues/1', createdAt: '2026-11-25T09:30:00.000Z' }, b: { source: 'session', status: 'running', isolation: 'docker', sessionName: 'solve-b' } },
  };
  const alive = describeInstanceState(state, { now, isAlive: () => true });
  assert(alive.instance.alive && alive.counts.queued === 1 && alive.counts.running === 1 && alive.counts.isolated === 1 && alive.busy === 2, 'counts running, isolated, queued and launching');
  const text = formatStatusText(alive);
  assert(text.includes('Intake: accepting') && text.includes('/solve https://github.com/o/r/issues/1') && text.includes('[docker]'), 'text lists intake and tasks');
  assert(describeInstanceState(state, { now, isAlive: () => false, self: { hostname: os.hostname(), pidNamespace: '' } }).instance.alive === false, 'dead PID on this host means not running');
  assert(describeInstanceState(state, { now: now + 10 * 60000, isAlive: () => true }).instance.alive === false, 'stale heartbeat means not running');
});

await asyncTest('restart: subscribers and queued tasks come back, starting ones do not', async () => {
  resetSubscribersForTests();
  let changes = 0;
  onSubscribersChanged(() => changes++);
  const restoredCount = restoreSubscribers([{ userId: '42', username: 'u', subscribedAt: '2026-11-25T09:00:00.000Z' }, { userId: 'bad' }]);
  assert(restoredCount === 1 && getSubscribers()[0].userId === 42, 'numeric user ids restored');
  addSubscriber(43, { username: 'v' });
  assert(changes >= 1, 'subscription changes notify the publisher');
  resetSubscribersForTests();

  const queue = newQueue();
  const tasks = {
    a: { source: 'queue', status: 'queued', url: 'https://github.com/o/r/issues/1', args: ['https://github.com/o/r/issues/1'], tool: 'claude', chatId: -100, messageId: 70, messageThreadId: 3, requesterUserId: 5, createdAt: '2026-11-25T09:00:00.000Z', isolation: 'docker' },
    b: { source: 'queue', status: 'waiting', url: 'https://github.com/o/r/issues/2', args: ['https://github.com/o/r/issues/2'], tool: 'claude', chatId: -100, messageId: 71, createdAt: '2026-11-25T09:01:00.000Z', dependencyMode: 'success', waitsFor: [{ type: 'item', itemId: 'a', label: '#1', names: [] }] },
    c: { source: 'queue', status: 'starting', url: 'https://github.com/o/r/issues/3', args: [] },
    d: { source: 'queue', status: 'queued', url: 'https://github.com/o/r/issues/4', args: ['x'], createdAt: '2026-11-25T09:02:00.000Z' },
    s: { source: 'session', status: 'running', url: 'https://github.com/o/r/issues/5' },
  };
  const store = newStore();
  await store.update(state => {
    state.tasks = tasks;
  });
  const persisted = (await store.read()).state.tasks;
  const result = await restoreQueuedTasks({ tasks: persisted, queue, telegram: fakeTelegram, isUrlActive: async url => ({ isActive: url.endsWith('/4') }), log: quiet });
  assert(result.restored.length === 2, 'queued and waiting tasks restored');
  assert(
    result.skipped
      .map(entry => entry.id)
      .sort()
      .join() === 'c,d',
    'starting task and URL already running are skipped'
  );
  const restoredA = queue.findByUrl('https://github.com/o/r/issues/1');
  assert(restoredA.id === 'a' && restoredA.createdAt.toISOString() === '2026-11-25T09:00:00.000Z' && restoredA.perCommandIsolation === 'docker', 'id, age and isolation kept');
  assert(restoredA.messageInfo.messageId === 70 && restoredA.ctx.telegram === fakeTelegram && restoredA.requesterUserId === 5, 'Telegram message can still be edited');
  const restoredB = queue.findByUrl('https://github.com/o/r/issues/2');
  assert(restoredB.status === 'waiting' && queue.dependencies.entries[0].targets[0].item === restoredA, 'waiting task waits for the restored item again');
  await queue.updateItemMessage(restoredA, 'restored status');
  assert(fakeTelegram.edits.at(-1)?.slice(0, 2).join() === '-100,70', 'the restored queue actually edits the original Telegram message');
  queue.stop();
});

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
