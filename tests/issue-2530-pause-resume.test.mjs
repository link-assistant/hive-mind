/**
 * @hive-mind-test-suite default
 * Regression coverage for issue #2530: a pause releases execution resources
 * while retaining the task and its filesystem for an explicit resume.
 */
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as monitor from '../src/session-monitor.lib.mjs';
import { createSessionStore, getPausedTaskContainerNames, serializeSessionInfo } from '../src/session-store.lib.mjs';
import { buildPausedTaskCommand, extractPauseWorkingDirectory } from '../src/session-pause.lib.mjs';
import { planDockerIsolationCleanup } from '../src/cleanup.lib.mjs';
import { runSystemCleanup } from '../src/cleanup.os.lib.mjs';
import { registerPauseResumeCommands } from '../src/telegram-pause-resume-command.lib.mjs';

const SESSION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const EXECUTION = '11111111-2222-3333-4444-555555555555';
const URL = 'https://github.com/example/project/issues/1';
const info = overrides => ({ chatId: -100, requesterUserId: 42, startTime: new Date(0), command: 'solve', tool: 'codex', url: URL, args: [URL, '--tool', 'codex'], sessionId: SESSION, executionUuid: EXECUTION, isolationBackend: 'docker', ...overrides });
afterEach(() => monitor.resetSessionMonitorForTests());
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-pause-test-'));
afterEach(() => {
  for (const name of fs.readdirSync(work)) fs.rmSync(path.join(work, name), { recursive: true, force: true });
});
process.on('exit', () => fs.rmSync(work, { recursive: true, force: true }));

function runnerFixture(overrides = {}) {
  let running = true;
  const calls = [];
  const logPath = path.join(work, 'task.log');
  fs.writeFileSync(logPath, 'Creating temporary directory: /tmp/original-clone\n📌 Session ID: first-session-123\n📌 Session ID: last-session-456\n');
  return {
    calls,
    querySessionStatus: async () => ({ exists: true, uuid: EXECUTION, sessionName: SESSION, status: running ? 'executing' : 'executed', logPath }),
    checkDockerContainerRunning: async () => running,
    checkDockerContainerExists: async () => true,
    markDockerTaskPaused: async () => ({ success: true }),
    stopIsolatedSession: async id => {
      calls.push(['stop', id]);
      running = false;
      return { success: true };
    },
    getDockerContainerWritableLayerSize: async () => 100,
    getStartCommandVersion: async () => '0.35.0',
    resumeIsolatedSession: async (id, options) => {
      calls.push(['resume', id, options]);
      return { success: true, sessionName: `${SESSION}-resume-1`, uuid: EXECUTION, mode: 'docker-snapshot' };
    },
    ...overrides,
  };
}

test('paused tasks survive monitoring without completion, recovery or cleanup', async () => {
  const session = info({ pauseState: 'paused', pausedAt: '2026-10-06T00:00:00.000Z', stopRequestedByUser: true });
  monitor.trackSession(SESSION, session);
  await monitor.monitorSessions({}, false, {
    statusProvider: () => {
      throw new Error('Paused tasks must not be probed');
    },
  });
  assert.equal(monitor.getTrackedSessionInfo(SESSION), session);
  assert.equal(monitor.getActiveSessionCount(), 0);
  assert.equal(monitor.getSessionStats().executing, 0);
});

test('pause state and saved workspace survive durable serialization', () => {
  const saved = serializeSessionInfo(info({ pauseState: 'paused', pausedAt: '2026-10-06T00:00:00.000Z', pauseWorkingDirectory: '/tmp/task', pauseRequestedBy: '@requester' }));
  assert.equal(saved.pauseState, 'paused');
  assert.equal(saved.pauseWorkingDirectory, '/tmp/task');
  assert.equal(saved.pausedAt, '2026-10-06T00:00:00.000Z');
});

test('paused task blocks duplicate work while freeing its running queue slot', async () => {
  monitor.trackSession(SESSION, info({ pauseState: 'paused' }));
  const statusProvider = () => {
    throw new Error('Paused task must not be queried');
  };
  assert.deepEqual(await monitor.hasActiveSessionForUrlAsync(URL, false, { statusProvider }), { isActive: true, sessionName: SESSION, status: 'paused' });
  assert.equal((await monitor.getRunningTrackedIsolationSessions(false, { statusProvider })).count, 0);
  assert.deepEqual(await monitor.getRunningSessionItems(false, { statusProvider }), []);
});

test('a task still being stopped or resumed retains its running queue slot', async () => {
  for (const pauseState of ['pausing', 'resuming']) {
    monitor.resetSessionMonitorForTests();
    monitor.trackSession(SESSION, info({ pauseState }));
    const statusProvider = () => {
      throw new Error('Control transitions must not be probed by queue queries');
    };
    assert.equal(monitor.getActiveSessionCount(), 1);
    assert.equal((await monitor.getRunningTrackedIsolationSessions(false, { statusProvider })).count, 1);
    assert.equal((await monitor.getRunningSessionItems(false, { statusProvider }))[0].status, pauseState);
  }
});

test('task lifecycle exposes explicit pause and resume operations', () => {
  assert.equal(typeof monitor.pauseTrackedSession, 'function');
  assert.equal(typeof monitor.resumePausedSession, 'function');
});

test('pause stops the whole container and explicit resume keeps disk and latest context', { timeout: 10000 }, async () => {
  const runner = runnerFixture();
  const store = createSessionStore({ dir: path.join(work, 'state') });
  monitor.setSessionStore(store);
  monitor.trackSession(SESSION, info({ containerResourceLimits: { diskBytes: 1000, requested: { disk: '1000' } } }));
  assert.equal((await monitor.pauseTrackedSession(EXECUTION, { runner, requestedBy: '@requester' })).success, true);
  assert.deepEqual(runner.calls[0], ['stop', EXECUTION]);
  assert.equal(store.load()[0].sessionInfo.pauseWorkingDirectory, '/tmp/original-clone');
  assert.ok(getPausedTaskContainerNames(store).has(SESSION));
  assert.equal((await monitor.pauseTrackedSession(SESSION, { runner })).alreadyPaused, true);
  assert.equal(runner.calls.length, 1);
  const result = await monitor.resumePausedSession(SESSION, { runner });
  assert.equal(result.success, true);
  assert.equal(result.sessionId, `${SESSION}-resume-1`);
  const resumed = monitor.getTrackedSessionInfo(result.sessionId);
  assert.equal(resumed.containerFilesystemInheritedBytes, 100);
  assert.equal(resumed.pauseState, undefined);
  assert.equal(resumed.stopRequestedByUser, undefined);
  assert.equal(resumed.lastToolSessionId, undefined);
  assert.equal(monitor.findControllableSession(SESSION).sessionName, result.sessionId);
  assert.equal(monitor.getActiveSessionCount(), 1);
  assert.equal(store.load().length, 1);
  assert.equal(getPausedTaskContainerNames(store).size, 0);
  assert.match(runner.calls[1][2].command, /'--working-directory' '\/tmp\/original-clone'/);
  assert.match(runner.calls[1][2].command, /'--resume' 'last-session-456'/);
  assert.equal((await monitor.resumePausedSession(EXECUTION, { runner })).success, false);
});

test('failed stop restores task state and leaves it monitored', async () => {
  const runner = runnerFixture({ stopIsolatedSession: async () => ({ success: false, error: 'Docker refused' }) });
  const session = info();
  monitor.trackSession(SESSION, session);
  const result = await monitor.pauseTrackedSession(SESSION, { runner });
  assert.equal(result.success, false);
  assert.equal(session.pauseState, undefined);
  assert.equal(session.stopRequestedByUser, undefined);
  assert.equal(monitor.getActiveSessionCount(), 1);
});

test('an unconfirmed stop stays protected until a retry confirms termination', async () => {
  const runner = runnerFixture({ stopIsolatedSession: async () => ({ success: true }) });
  monitor.trackSession(SESSION, info());
  assert.equal((await monitor.pauseTrackedSession(SESSION, { runner })).success, false);
  assert.equal(monitor.getTrackedSessionInfo(SESSION).pauseState, 'pausing');
  runner.checkDockerContainerRunning = async () => false;
  assert.equal((await monitor.pauseTrackedSession(SESSION, { runner })).success, true);
  assert.equal(monitor.getTrackedSessionInfo(SESSION).pauseState, 'paused');
});

test('failed resume and missing container retain paused disk state without a fresh launch', async () => {
  const runner = runnerFixture({ resumeIsolatedSession: async () => ({ success: false, error: 'refused' }) });
  monitor.trackSession(SESSION, info());
  await monitor.pauseTrackedSession(SESSION, { runner });
  assert.equal((await monitor.resumePausedSession(SESSION, { runner })).success, false);
  assert.equal(monitor.getTrackedSessionInfo(SESSION).pauseState, 'paused');
  runner.checkDockerContainerExists = async () => false;
  assert.match((await monitor.resumePausedSession(SESSION, { runner })).error, /missing/);
  assert.equal(monitor.getTrackedSessionInfo(SESSION).pauseState, 'paused');
});

test('persistence failure prevents a stop or resume', async () => {
  const runner = runnerFixture();
  monitor.setSessionStore({
    persist: () => {
      throw new Error('disk full');
    },
  });
  // trackSession uses best-effort persistence; explicit control fails closed.
  monitor.trackSession(SESSION, info());
  assert.equal((await monitor.pauseTrackedSession(SESSION, { runner })).success, false);
  assert.deepEqual(runner.calls, []);
  assert.equal(monitor.getTrackedSessionInfo(SESSION).pauseState, undefined);
});

test('strict durable writes expose failures rather than silently stopping work', () => {
  const store = createSessionStore({
    dir: work,
    fsImpl: {
      ...fs,
      writeFileSync: () => {
        throw new Error('disk full');
      },
    },
  });
  assert.throws(() => store.persist(SESSION, info(), { strict: true }), /persist/);
});

test('workspace retention failure prevents stopping the task', async () => {
  const runner = runnerFixture({ markDockerTaskPaused: async () => ({ success: false, error: 'read-only filesystem' }) });
  monitor.trackSession(SESSION, info());
  assert.equal((await monitor.pauseTrackedSession(SESSION, { runner })).success, false);
  assert.deepEqual(runner.calls, []);
  assert.equal(monitor.getTrackedSessionInfo(SESSION).pauseState, undefined);
});

test('resume persistence failure prevents launching a replacement', async () => {
  const runner = runnerFixture();
  monitor.trackSession(SESSION, info());
  await monitor.pauseTrackedSession(SESSION, { runner });
  monitor.setSessionStore({
    persist: () => {
      throw new Error('disk full');
    },
  });
  assert.equal((await monitor.resumePausedSession(SESSION, { runner })).success, false);
  assert.equal(runner.calls.filter(([action]) => action === 'resume').length, 0);
  assert.ok(monitor.getTrackedSessionInfo(SESSION).pauseState);
});

test('missing original solve workspace refuses resume without discarding its container', async () => {
  const runner = runnerFixture();
  monitor.trackSession(SESSION, info());
  await monitor.pauseTrackedSession(SESSION, { runner });
  monitor.getTrackedSessionInfo(SESSION).pauseWorkingDirectory = null;
  assert.match((await monitor.resumePausedSession(SESSION, { runner })).error, /working directory/);
  assert.equal(runner.calls.filter(([action]) => action === 'resume').length, 0);
  assert.equal(monitor.getTrackedSessionInfo(SESSION).pauseState, 'paused');
});

test('limited resumes retain CPU/RAM controls and reject unsupported CLI versions', async () => {
  const reapplied = [];
  const requested = { cpu: '0.5', memory: '64m' };
  const runner = runnerFixture({
    applyDockerContainerResourceLimits: async (...args) => {
      reapplied.push(args);
      return { success: true };
    },
  });
  monitor.trackSession(SESSION, info({ containerResourceLimits: { cpuCores: 0.5, memoryBytes: 67108864, requested } }));
  await monitor.pauseTrackedSession(SESSION, { runner });
  runner.getStartCommandVersion = async () => '0.34.0';
  assert.equal((await monitor.resumePausedSession(SESSION, { runner })).success, false);
  assert.equal(runner.calls.filter(([action]) => action === 'resume').length, 0);
  runner.getStartCommandVersion = async () => '0.35.0';
  assert.equal((await monitor.resumePausedSession(SESSION, { runner })).success, true);
  assert.deepEqual(reapplied, [[`${SESSION}-resume-1`, requested]]);
  assert.equal(monitor.getTrackedSessionInfo(`${SESSION}-resume-1`).containerResourceLimits.memoryBytes, 67108864);
});

test('unsupported backends and router tasks are refused before changing execution', async () => {
  for (const overrides of [{ isolationBackend: 'screen' }, { args: [URL, '--use-router'] }]) {
    monitor.resetSessionMonitorForTests();
    const runner = runnerFixture();
    monitor.trackSession(SESSION, info(overrides));
    assert.equal((await monitor.pauseTrackedSession(SESSION, { runner })).success, false);
    assert.deepEqual(runner.calls, []);
    assert.equal(monitor.getTrackedSessionInfo(SESSION).pauseState, undefined);
  }
});

test('concurrent resume requests launch one replacement', { timeout: 10000 }, async () => {
  let release;
  const held = new Promise(resolve => {
    release = resolve;
  });
  const runner = runnerFixture();
  monitor.trackSession(SESSION, info());
  await monitor.pauseTrackedSession(SESSION, { runner });
  const resume = runner.resumeIsolatedSession;
  runner.resumeIsolatedSession = async (...args) => {
    await held;
    return resume(...args);
  };
  const first = monitor.resumePausedSession(SESSION, { runner });
  const second = await monitor.resumePausedSession(EXECUTION, { runner });
  release();
  assert.equal(second.success, false);
  assert.equal((await first).success, true);
  assert.equal(runner.calls.filter(([action]) => action === 'resume').length, 1);
});

test('concurrent pause requests stop a session once', { timeout: 10000 }, async () => {
  let release;
  const held = new Promise(resolve => {
    release = resolve;
  });
  const runner = runnerFixture();
  const status = runner.querySessionStatus;
  runner.querySessionStatus = async () => {
    await held;
    return status();
  };
  monitor.trackSession(SESSION, info());
  const first = monitor.pauseTrackedSession(SESSION, { runner });
  const second = await monitor.pauseTrackedSession(EXECUTION, { runner });
  assert.equal(second.success, false);
  release();
  assert.equal((await first).success, true);
  assert.equal(runner.calls.length, 1);
});

test('monitor and pause share a lock', { timeout: 10000 }, async () => {
  let release;
  const held = new Promise(resolve => {
    release = resolve;
  });
  monitor.trackSession(SESSION, info());
  const tick = monitor.monitorSessions({}, false, {
    statusProvider: async () => {
      await held;
      return { exists: true, status: 'executing' };
    },
    backendAlive: async () => true,
  });
  assert.match((await monitor.pauseTrackedSession(SESSION, { runner: runnerFixture() })).error, /monitored/);
  release();
  await tick;
});

test('bot restart retains paused tasks and does not probe or restart them', async () => {
  const store = createSessionStore({ dir: path.join(work, 'state') });
  store.persist(SESSION, info({ pauseState: 'paused', pauseWorkingDirectory: '/tmp/clone' }));
  const resumed = await monitor.resumeTrackedSessions({ store, isolationRunner: {} });
  assert.equal(resumed.resumed.length, 1);
  assert.equal(monitor.getTrackedSessionInfo(SESSION).pauseState, 'paused');
  assert.equal(monitor.getActiveSessionCount(), 0);
});

test('startup reconciles an interrupted pause without restarting the work', async () => {
  const store = createSessionStore({ dir: path.join(work, 'state') });
  store.persist(SESSION, info({ pauseState: 'pausing' }));
  monitor.setSessionStore(store);
  await monitor.resumeTrackedSessions({ store, isolationRunner: runnerFixture() });
  assert.equal(store.load()[0].sessionInfo.pauseState, 'paused');
});

test('a failed stop that actually stopped Docker retains pause protection', async () => {
  const runner = runnerFixture();
  const stop = runner.stopIsolatedSession;
  runner.stopIsolatedSession = async id => {
    await stop(id);
    return { success: false, error: 'CLI interrupted after stop' };
  };
  monitor.trackSession(SESSION, info());
  assert.equal((await monitor.pauseTrackedSession(SESSION, { runner })).success, false);
  assert.equal(monitor.getTrackedSessionInfo(SESSION).pauseState, 'pausing');
});

test('startup adopts an interrupted resume even when its replacement already finished', async () => {
  const store = createSessionStore({ dir: path.join(work, 'state') });
  store.persist(SESSION, info({ pauseState: 'resuming', containerFilesystemInheritedBytes: 20, containerFilesystemLastBytes: 100 }));
  monitor.setSessionStore(store);
  const next = `${SESSION}-resume-1`;
  const runner = runnerFixture({ querySessionStatus: async () => ({ uuid: EXECUTION, sessionName: next, status: 'executed' }), checkDockerContainerRunning: async () => false });
  await monitor.resumeTrackedSessions({ store, isolationRunner: runner });
  assert.equal(monitor.getTrackedSessionInfo(SESSION), null);
  assert.equal(monitor.getTrackedSessionInfo(next).pauseState, undefined);
  assert.equal(monitor.getTrackedSessionInfo(next).containerFilesystemInheritedBytes, 120);
  assert.equal(store.load().length, 1);
  assert.equal(store.load()[0].sessionName, next);
  assert.deepEqual(runner.calls, []);
});

test('pause marker preserves a solve workspace even with automatic cleanup enabled', async () => {
  const { cleanupTempDirectory } = await import('../src/solve.cleanup.lib.mjs');
  const directory = path.join(work, 'private-clone');
  const marker = path.join(work, 'pause-marker');
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'uncommitted.txt'), 'unfinished work');
  fs.writeFileSync(marker, '');
  await cleanupTempDirectory(directory, { autoCleanup: true }, false, { pauseMarkerPath: marker });
  assert.equal(fs.readFileSync(path.join(directory, 'uncommitted.txt'), 'utf8'), 'unfinished work');
});

test('workspace parsing and shell quoting preserve literal user arguments', () => {
  assert.equal(extractPauseWorkingDirectory('Creating temporary directory: /tmp/first\n  Repository dir: /tmp/second\n'), '/tmp/second');
  assert.equal(extractPauseWorkingDirectory('the Working directory: /tmp/wrong'), null);
  const command = buildPausedTaskCommand(info({ args: [URL, '--resume=old-session', '--working-directory', '/tmp/old', '--requirements', 'literal $(touch /tmp/unwanted) `id`'], pauseWorkingDirectory: "/tmp/task's clone" }), 'latest-session');
  assert.deepEqual(command.args, [URL, '--requirements', 'literal $(touch /tmp/unwanted) `id`', '--working-directory', "/tmp/task's clone", '--resume', 'latest-session']);
  assert.match(command.display, /'literal \$\(touch \/tmp\/unwanted\) `id`'/);
  assert.match(command.display, /'\/tmp\/task'\\''s clone'/);
});

test('cleanup retains paused containers even in all mode and skips host prune', async () => {
  const plan = planDockerIsolationCleanup({ mode: 'all', containers: [{ name: SESSION, state: 'exited', exitCode: 0, pausedByUser: true }] });
  assert.equal(plan.remove.length, 0);
  assert.equal(plan.keep[0].reason, 'paused-task');
  assert.equal(monitor.buildDockerTaskContainerCompletionAction({ sessionName: SESSION, sessionInfo: info({ pauseState: 'paused' }), env: { HIVE_MIND_KEEP_TASK_CONTAINER: 'never' } }).shouldRemove, false);
  const calls = [];
  const logs = [];
  await runSystemCleanup({
    docker: true,
    pausedContainerNames: new Set([SESSION]),
    execFn: (...args) => {
      calls.push(args);
      return '';
    },
    logFn: line => logs.push(line),
  });
  assert.deepEqual(calls, []);
  assert.ok(logs.some(line => line.includes('paused task')));
});

function telegramFixture({ userId = 42, chatId = -100, chatType = 'supergroup', owner = false, authorized = true, old = false, forwarded = false } = {}) {
  const handlers = {};
  const replies = [];
  const calls = [];
  const record = { sessionName: SESSION, sessionInfo: info({ pauseState: 'paused' }) };
  registerPauseResumeCommands(
    {
      command: (name, handler) => {
        handlers[name] = handler;
      },
    },
    {
      isOldMessage: () => old,
      isForwarded: () => forwarded,
      isGroupChat: () => chatType === 'supergroup',
      isChatAuthorized: () => authorized,
      safeReply: async (_ctx, text) => {
        replies.push(text);
      },
      monitor: {
        findControllableSession: () => record,
        findStoppableSessionByUrl: () => record,
        getPausedSessions: () => [record],
        pauseTrackedSession: async (...args) => {
          calls.push(['pause', ...args]);
          return { success: true };
        },
        resumePausedSession: async (...args) => {
          calls.push(['resume', ...args]);
          return { success: true, sessionId: SESSION };
        },
      },
    }
  );
  const ctx = { message: { message_id: 5 }, from: { id: userId }, chat: { id: chatId, type: chatType }, telegram: { getChatMember: async () => ({ status: owner ? 'creator' : 'member' }) } };
  return { handlers, ctx, replies, calls };
}

test('Telegram accepts UUID, URL, bot mention and replies from task requester', async () => {
  for (const text of [`/pause ${SESSION}`, `/pause ${URL}`, `/pause@HiveBot ${SESSION}`, '/pause']) {
    const fixture = telegramFixture();
    fixture.ctx.message.text = text;
    fixture.ctx.message.reply_to_message = { text: `Session: ${SESSION}` };
    await fixture.handlers.pause(fixture.ctx);
    assert.equal(fixture.calls[0][0], 'pause');
    assert.equal(fixture.calls[0][1], SESSION);
  }
  const fixture = telegramFixture({ chatType: 'private' });
  fixture.ctx.message.text = `/resume ${SESSION}`;
  await fixture.handlers.resume(fixture.ctx);
  assert.equal(fixture.calls[0][0], 'resume');
});

test('Telegram rejects strangers, foreign chats, unauthorized, stale and forwarded controls', async () => {
  for (const options of [{ userId: 99 }, { userId: 99, chatType: 'private' }, { chatId: -200, owner: true }, { authorized: false }, { old: true }, { forwarded: true }]) {
    const fixture = telegramFixture(options);
    fixture.ctx.message.text = `/resume ${SESSION}`;
    await fixture.handlers.resume(fixture.ctx);
    assert.deepEqual(fixture.calls, []);
  }
  const fixture = telegramFixture({ userId: 99, owner: true });
  fixture.ctx.message.text = `/resume ${URL}`;
  await fixture.handlers.resume(fixture.ctx);
  assert.equal(fixture.calls.length, 1);
});

test('bare /resume lists the requester’s paused tasks', async () => {
  const fixture = telegramFixture();
  fixture.ctx.message.text = '/resume';
  await fixture.handlers.resume(fixture.ctx);
  assert.match(fixture.replies[0], /Your paused tasks/);
  assert.match(fixture.replies[0], /aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/);
  assert.deepEqual(fixture.calls, []);
});
