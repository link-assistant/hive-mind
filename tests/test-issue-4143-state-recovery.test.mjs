/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';

import { createBotInstanceState, restoreQueuedTasks } from '../src/bot-instance-state.lib.mjs';
import { describeInstanceState, runInstanceStateCommand } from '../src/bot-instance-status.lib.mjs';
import { createLinksStore, decodeDoublets } from '../src/bot-state-links.lib.mjs';
import { formatVerifiedLinoTree } from '../src/bot-state-lino.lib.mjs';
import { applyBotStateMigration, migrateBotState, resolveBotStateMigrationTarget } from '../src/bot-state-migrations.lib.mjs';
import { createBotStateStore, stateToStringTree } from '../src/bot-state-store.lib.mjs';
import { currentLockOwner, withStateLock } from '../src/state-lock.lib.mjs';
import { SolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { getChatStopInfo, getStoppedChats, onStoppedChatsChanged, restoreStoppedChats, setChatStopped } from '../src/telegram-start-stop-command.lib.mjs';

const run = promisify(execFile);
const quiet = () => {};
const deferred = () => Promise.withResolvers();
const command = async (config, options) => {
  const output = [];
  const code = await runInstanceStateCommand({ json: true, ...config }, { out: line => output.push(JSON.parse(line)), err: quiet, ...options });
  return { code, output: output.at(-1) };
};

async function setup(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hm-4143-recovery-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const env = { ...process.env, HIVE_MIND_STATE_DIR: dir };
  return { env, store: createBotStateStore({ env, readRetries: 0, log: quiet, ...options }) };
}

const queueState = {
  blocked: {
    source: 'queue',
    status: 'waiting',
    url: 'https://github.com/o/r/issues/2',
    createdAt: '2026-11-25T12:04:00.000Z',
    args: ['--tool', 'agent'],
    waitsFor: [
      { type: 'item', itemId: 'first', names: ['session-1'] },
      { type: 'session', names: ['session-2'] },
    ],
  },
  first: { source: 'queue', status: 'queued', url: 'https://github.com/o/r/issues/1', args: ['https://github.com/o/r/issues/1'], createdAt: '2026-11-25T12:00:00.000Z', chatId: -100, messageId: 71, showLimits: true, limitsAtStart: { toolKey: 'claude', success: false, usage: { sevenDay: { percentage: 12.5 } } } },
};

test('manual and automatic migrations update both copies and preserve delivered work', { timeout: 20000 }, async t => {
  const { env, store } = await setup(t);
  const binary = await store.linksStore.available();
  if (env.HIVE_MIND_REQUIRE_CLINK === '1') assert.equal(binary, true, 'link-cli must be available in this suite');
  await store.update(state => {
    state.tasks = queueState;
    state.subscribers = { 5: { userId: 5, username: 'subscriber' } };
  });
  const firstRead = await store.read();
  assert.equal(firstRead.schemaVersion, 1);
  assert.deepEqual(firstRead.state.tasks, queueState);
  assert.equal(firstRead.consistent, binary ? true : null);
  if (binary && env.HIVE_MIND_REQUIRE_CLINK === '1') {
    const { stdout } = await run(store.linksStore.command, ['--db', store.paths.links, '--log', '--retention', 'sized:64']);
    const rows = stdout.trim().split('\n');
    assert.ok(rows.length > 2);
    assert.equal(new Set(rows.map(row => row.split('\t')[3])).size, 1, 'initial import uses one transaction');
  }

  const down = await command({ stateMigrate: '0' }, { store });
  assert.deepEqual(down, { code: 0, output: { schemaVersion: 0, written: true, binaryWritten: binary, complete: true } });
  const downgraded = await store.read();
  assert.equal(downgraded.schemaVersion, 0);
  assert.equal(Object.hasOwn(downgraded.state, 'version'), false);
  assert.deepEqual(downgraded.state.tasks, queueState);
  assert.deepEqual(downgraded.state.subscribers, firstRead.state.subscribers);
  assert.equal((await command({ stateMigrate: '0' }, { store })).output.written, false);

  async function startAt(value, expected) {
    const instance = createBotInstanceState({ store, env: { ...env, HIVE_MIND_STATE_SCHEMA_TARGET: value }, intervalMs: 60000, log: quiet });
    const queue = new SolveQueue({ autoStart: false });
    let subscribers = [];
    try {
      await instance.start({
        queue,
        restore: tasks => restoreQueuedTasks({ tasks, queue }),
        getSubscribers: () => subscribers,
        restoreSubscribers: saved => (subscribers = saved).length,
      });
      const read = await store.read();
      assert.equal(read.schemaVersion, expected);
      assert.equal(read.consistent, binary ? true : null);
      assert.equal(read.state.tasks.blocked.waitsFor[0].itemId, 'first');
      assert.equal(read.state.tasks.first.messageId, 71);
      assert.deepEqual(read.state.tasks.first.limitsAtStart, queueState.first.limitsAtStart);
      assert.deepEqual(read.state.subscribers, firstRead.state.subscribers);
      await assert.rejects(command({ stateMigrate: 0 }, { store }), /Stop the bot/);
    } finally {
      await instance.stop();
    }
  }

  await startAt('off', 0);
  await startAt(undefined, 1);
  await startAt('0', 0);
  assert.equal((await command({ stateMigrate: '1' }, { store })).output.schemaVersion, 1);
  await assert.rejects(command({ stateMigrate: '9' }, { store }), /Unsupported bot state schema/);
});

test('migration definitions generate inverse steps in reverse order and validate explicit rollback', () => {
  const initial = { old: 'work', other: 9 };
  const changes = {
    up: [
      { rename: 'old', to: 'task' },
      { add: 'old', value: 'default' },
    ],
  };
  const upgraded = applyBotStateMigration(initial, changes, 'up');
  assert.deepEqual(upgraded, { task: 'work', old: 'default', other: 9 });
  assert.deepEqual(applyBotStateMigration(upgraded, changes, 'down'), initial);
  assert.deepEqual(applyBotStateMigration({}, { up: [{ remove: 'version' }], down: [{ add: 'version', value: 1 }] }, 'down'), { version: 1 });
  assert.throws(() => applyBotStateMigration({}, { up: [{ remove: 'task' }] }, 'down'), /requires an explicit down/);
  assert.throws(() => applyBotStateMigration({ ...upgraded, old: 'edit' }, changes, 'down'), /Cannot remove field old/);
  assert.throws(() => applyBotStateMigration({}, changes, 'up'), /missing bot state field/);
  assert.throws(() => applyBotStateMigration({ old: 1, task: 2 }, changes, 'up'), /overwrite field/);
  assert.throws(() => migrateBotState({ version: 'broken' }, 1), /Unsupported/);
  assert.throws(() => resolveBotStateMigrationTarget({ HIVE_MIND_STATE_SCHEMA_TARGET: 'false' }), /Unsupported/);
  assert.equal(resolveBotStateMigrationTarget({}), 1);
});

test('an interrupted mirror migration is readable and repairable without losing tasks', { timeout: 10000 }, async t => {
  let binaryTree;
  let failRead = false;
  let failWrite = false;
  const linksStore = {
    dbPath: 'mirror',
    available: async () => true,
    read: async () => {
      if (failRead) throw new Error('mirror interrupted');
      return binaryTree ?? null;
    },
    write: async (tree, { repair }) => {
      if (failWrite || (failRead && !repair)) throw new Error('mirror interrupted');
      binaryTree = tree;
      failRead = false;
      return true;
    },
  };
  const { store } = await setup(t, { linksStore });
  await store.update(state => {
    state.tasks = queueState;
  });
  failWrite = true;
  const failed = await command({ stateMigrate: '0' }, { store });
  assert.equal(failed.code, 1, 'an incomplete migration reports failure');
  assert.equal(failed.output.complete, false);
  assert.equal(binaryTree.version, '1');
  const interrupted = await store.read();
  assert.equal(interrupted.schemaVersion, 0);
  assert.equal(interrupted.source, 'lino');
  assert.equal(interrupted.consistent, false);
  assert.deepEqual(interrupted.state.tasks, queueState);
  failWrite = false;
  failRead = true;
  assert.equal((await command({ stateMigrate: '0' }, { store })).output.written, true, 'a corrupt mirror is rebuilt from valid text');
  assert.equal((await store.read()).consistent, true);

  failRead = true;
  await fs.writeFile(store.paths.lino, 'unrelated_root:\n');
  const unreadable = await command({ status: true }, { store });
  assert.equal(unreadable.code, 1);
  assert.equal(unreadable.output.errors.length, 2);
  await assert.rejects(
    store.update(() => {}),
    /No readable bot state copy/
  );
  assert.equal(await fs.readFile(store.paths.lino, 'utf8'), 'unrelated_root:\n');
});

test('an interrupted startup retains queued work and chat stops for the next instance', { timeout: 10000 }, async t => {
  const { store } = await setup(t);
  const initial = { stoppedAt: '2026-11-25T12:00:00.000Z', stoppedBy: { id: '12', username: 'owner', firstName: 'Owner' }, reason: 'maintenance' };
  await store.update(state => {
    state.tasks = queueState;
    state.stoppedChats = { '-4143': initial };
  });
  const restoring = deferred();
  const release = deferred();
  const interrupted = createBotInstanceState({ store, intervalMs: 60000, log: quiet });
  const starting = interrupted.start({
    restore: () => {
      restoring.resolve();
      return release.promise;
    },
  });
  await restoring.promise;
  try {
    assert.equal(await interrupted.tick({ force: true }), null);
    await interrupted.stop();
    assert.deepEqual((await store.read()).state.tasks, queueState);
  } finally {
    release.resolve();
    await starting;
  }
  const recovered = createBotInstanceState({ store, intervalMs: 60000, log: quiet });
  try {
    await recovered.start({ getStoppedChats, onStoppedChatsChanged, restoreStoppedChats });
    assert.deepEqual(getChatStopInfo(-4143), { ...initial, stoppedAt: new Date(initial.stoppedAt), stoppedBy: { ...initial.stoppedBy, id: 12 } });
    assert.deepEqual((await store.read()).state.stoppedChats, { '-4143': initial });
    setChatStopped(-4143, false);
    await recovered.tick();
    assert.deepEqual((await store.read()).state.stoppedChats ?? {}, {});
  } finally {
    await recovered.stop();
    setChatStopped(-4143, false);
  }
});

test('PID mode protects an old live lock and age mode can expire it', { timeout: 5000 }, async t => {
  const { store } = await setup(t);
  const lockPath = store.paths.lock;
  await fs.mkdir(lockPath);
  await fs.writeFile(path.join(lockPath, 'owner.json'), JSON.stringify(currentLockOwner()));
  const old = new Date(Date.now() - 10000);
  await fs.utimes(lockPath, old, old);
  const options = { lockPath, staleMs: 3000, timeoutMs: 10, pollMs: 1 };
  const critical = () => 'locked';
  await assert.rejects(withStateLock('bot-state', critical, { ...options, mode: 'pid' }), /Timed out/);
  assert.equal(await withStateLock('bot-state', critical, { ...options, mode: 'age' }), 'locked');
  await assert.rejects(fs.stat(lockPath), { code: 'ENOENT' });
});

test('drain closes the gate before the acknowledged snapshot is durable', { timeout: 10000 }, async t => {
  const { store } = await setup(t, { linksStore: createLinksStore({ dbPath: 'disabled', command: null }) });
  const committed = deferred();
  const release = deferred();
  let pauseAfterWrite = false;
  const publisherStore = {
    ...store,
    async update(...args) {
      const result = await store.update(...args);
      if (pauseAfterWrite) {
        committed.resolve();
        await release.promise;
      }
      return result;
    },
  };
  const instance = createBotInstanceState({ store: publisherStore, intervalMs: 60000, log: quiet });
  t.after(() => {
    release.resolve();
    return instance.stop();
  });
  assert.equal(instance.isIntakePaused(), true);
  await instance.start({});
  assert.equal(instance.isIntakePaused(), false);
  await command({ drain: true }, { store });
  pauseAfterWrite = true;
  const tick = instance.tick();
  await committed.promise;
  assert.equal(instance.isIntakePaused(), true, 'the gate is closed even though the publisher has not returned');
  assert.equal(describeInstanceState((await store.read()).state).drained, true);
  release.resolve();
  await tick;
});

test('a queue reservation resolving after drain keeps the candidate queued', { timeout: 10000 }, async () => {
  const reserving = deferred();
  const reserved = deferred();
  const waiting = deferred();
  const resumePoll = deferred();
  let paused = false;
  let released = false;
  const queue = new SolveQueue({ autoStart: false, isIntakePaused: () => paused, verbose: false });
  queue.enqueue({ url: 'https://github.com/o/r/issues/1', tool: 'claude', args: ['x'] });
  queue.isRunning = true;
  queue.findStartableItems = async () => [{ tool: 'claude' }];
  queue.reserveStartSlot = () => {
    reserving.resolve();
    return reserved.promise;
  };
  queue.sleep = () => {
    waiting.resolve();
    return resumePoll.promise;
  };
  const consumer = queue.runConsumer();
  await reserving.promise;
  paused = true;
  reserved.resolve({
    startReserved: true,
    releaseStartReservation: () => {
      released = true;
    },
  });
  await waiting.promise;
  try {
    assert.equal(released, true);
    assert.equal(queue.getTotalQueueLength(), 1);
    assert.equal(queue.processing.size, 0);
  } finally {
    queue.stop();
    resumePoll.resolve();
    await consumer;
  }
});

test('large status JSON stays complete through the token-free CLI', { timeout: 20000 }, async t => {
  const { env, store } = await setup(t, { linksStore: createLinksStore({ dbPath: 'disabled', command: null }) });
  const tasks = Object.fromEntries(Array.from({ length: 160 }, (_, index) => [`queue-${index}`, { ...queueState.first, url: `https://github.com/o/r/issues/${index}` }]));
  await store.update(state => {
    state.tasks = tasks;
  });
  const cli = ['src/telegram-bot.mjs', '--state-dir', store.paths.dir, '--json'];
  const options = { env: { ...env, HIVE_MIND_CLINK: 'off', TELEGRAM_BOT_TOKEN: '' } };
  const status = await run(process.execPath, [...cli, '--status'], options);
  assert.equal(JSON.parse(status.stdout).counts.queued, 160);
  assert.equal(JSON.parse(status.stdout).schemaVersion, 1);
  const down = await run(process.execPath, [...cli, '--state-migrate', '0'], options);
  assert.equal(JSON.parse(down.stdout).schemaVersion, 0);
});

test('corrupt codec references and unsupported state versions fail closed', async t => {
  assert.throws(() => decodeDoublets('(hive_mind_state: hive_mind_state missing)'), /Missing link/);
  assert.throws(() => decodeDoublets('(hive_mind_state: hive_mind_state root)\n(root: ~obj body)\n(body: entry body)'), /Cyclic list/);
  assert.throws(() => decodeDoublets('(hive_mind_state: hive_mind_state root)\n(root: invalid body)'), /Unknown container/);
  assert.throws(() => decodeDoublets('(hive_mind_state: hive_mind_state point)\n(point: point point)'), /root must be an object/);
  const { store } = await setup(t, { linksStore: createLinksStore({ dbPath: 'disabled', command: null }) });
  await fs.writeFile(store.paths.lino, await formatVerifiedLinoTree(stateToStringTree({ version: 99, tasks: queueState })));
  await assert.rejects(
    store.update(() => {}),
    /Unsupported bot state schema version 99/
  );
  assert.match(await fs.readFile(store.paths.lino, 'utf8'), /version 99/);
});
