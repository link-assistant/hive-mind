/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import * as monitor from '../src/session-monitor.lib.mjs';
import { createSessionStore, getProtectedTaskContainerNames } from '../src/session-store.lib.mjs';
import { parseSessionStatusOutput } from '../src/isolation-runner.parsers.lib.mjs';
import { planDockerIsolationCleanup } from '../src/cleanup.lib.mjs';
import { mergeToolWork } from '../src/queue-work.lib.mjs';
import { collectExecutingItems, formatQueueToolSection } from '../src/telegram-solve-queue.helpers.lib.mjs';
import { registerPauseResumeCommands } from '../src/telegram-pause-resume-command.lib.mjs';
import { reportDockerPause } from '../src/telegram-task-pause-display.lib.mjs';
import { loadTranslations, t } from '../src/i18n.lib.mjs';

const SESSION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const EXECUTION = '11111111-2222-4333-8444-555555555555';
const NEXT = `${SESSION}-resume-1`;
const TASK_URL = 'https://github.com/example/project/issues/1';
const WHEN = '2026-10-06T00:00:00.000Z';
const info = overrides => ({ chatId: -100, requesterUserId: 42, startTime: new Date(0), command: 'solve', tool: 'codex', url: TASK_URL, args: [TASK_URL, '--tool', 'codex'], sessionId: SESSION, executionUuid: EXECUTION, isolationBackend: 'docker', ...overrides });

afterEach(() => {
  monitor.resetSessionMonitorForTests();
  monitor.__setIsolationRunnerForTests(null);
});

await loadTranslations('en');

async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'hive-pause-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function setup(overrides, initial = {}) {
  const state = { docker: 'running', count: 0, pauses: 0, name: SESSION, calls: [], ...initial };
  const runner = {
    querySessionStatus: async () => ({ exists: true, uuid: EXECUTION, sessionName: state.name, status: 'executing', resumeCount: state.count }),
    inspectDockerContainerState: async name => (name === state.name ? state.docker : 'removed'),
    checkBackendSessionAlive: async () => state.docker === 'running',
    isExecutingSessionStatus: status => status === 'executing',
    isTerminalSessionStatus: () => false,
    checkDockerContainerExists: async () => state.docker !== 'removed',
    inspectDockerTaskLaunch: async () => ({ commandHandoff: true }),
    pauseDockerSession: async (id, options) => {
      state.calls.push(['pause', id]);
      if (state.docker === 'paused') return { success: true, status: 'already-paused', pausedAt: WHEN, pauseCount: state.pauses };
      state.docker = 'paused';
      return { success: true, status: 'paused', pausedAt: WHEN, pauseCount: ++state.pauses, pausedBy: options.requestedBy };
    },
    unpauseDockerSession: async id => {
      state.calls.push(['unpause', id]);
      if (state.docker === 'running') return { success: true, status: 'not-paused' };
      state.docker = 'running';
      return { success: true, status: 'unpaused' };
    },
    markDockerTaskForStop: async name => state.calls.push(['retain', name]),
    stopIsolatedSession: async id => {
      state.calls.push(['stop', id]);
      state.docker = 'exited';
      return { success: true };
    },
    resumeIsolatedSession: async (id, options) => {
      state.calls.push(['resume', id, options]);
      state.docker = 'running';
      state.count++;
      state.name = NEXT;
      return { success: true, mode: 'docker-snapshot', sessionName: NEXT, uuid: EXECUTION };
    },
    getDockerContainerWritableLayerSize: async () => 100,
    getStartCommandVersion: async () => '0.44.0',
    ...overrides,
  };
  monitor.__setIsolationRunnerForTests(runner);
  return { state, runner };
}

test('freeze and unfreeze are idempotent and retain separate pause metadata per freeze', async () => {
  const { state } = setup();
  const session = info();
  monitor.trackSession(SESSION, session);
  assert.equal((await monitor.pauseTrackedSession(EXECUTION, { requestedBy: '@operator', reason: 'CPU incident' })).success, true);
  assert.equal(session.pausedAt, WHEN);
  assert.equal(session.pausedBy, '@operator');
  assert.equal(session.pauseReason, 'CPU incident');
  assert.equal(session.pauseCount, 1);
  assert.equal((await monitor.pauseTrackedSession(SESSION)).alreadyPaused, true);
  assert.equal(session.pauseCount, 1);
  assert.match((await monitor.resumeStoppedSession(SESSION)).error, /\/unpause/);
  assert.equal((await monitor.unpauseTrackedSession(EXECUTION)).success, true);
  assert.equal(session.pausedAt, undefined);
  assert.equal(session.pauseReason, undefined);
  assert.equal((await monitor.unpauseTrackedSession(SESSION)).notPaused, true);
  assert.equal((await monitor.pauseTrackedSession(SESSION)).success, true);
  assert.equal(session.pauseCount, 2);
  assert.equal(
    state.calls.some(([verb]) => ['stop', 'resume'].includes(verb)),
    false
  );
});

test('manual freeze frees capacity, keeps URL claimed, and shows a separate queue row', async () => {
  const { state } = setup({}, { docker: 'paused', name: NEXT });
  monitor.trackSession(SESSION, info());
  const { isActive, status } = await monitor.hasActiveSessionForUrlAsync(TASK_URL);
  assert.equal(isActive, true);
  assert.equal(status, 'paused');
  assert.equal((await monitor.getRunningTrackedIsolationSessions()).count, 0);
  const sessionItems = await monitor.getRunningSessionItems();
  const work = mergeToolWork({ sessionItems, processingItems: [{ tool: 'codex', url: TASK_URL }] });
  assert.equal(work.total, 0);
  assert.equal(work.paused.length, 1);
  const paused = collectExecutingItems({ sessionItems: work.paused, tool: 'codex', byExecution: true });
  const labels = { processing: 'Processing', paused: 'Paused', pending: 'Pending', completed: 'Completed', failed: 'Failed' };
  const queue = formatQueueToolSection({ tool: 'codex', labels, executing: [], paused, pendingItems: [], completed: [], failed: [], max: 3, locale: 'en' });
  assert.match(queue, /Paused.*1/);
  assert.match(queue, /⏸/);
  assert.doesNotMatch(queue, /Processing.*1/);
  await monitor.monitorSessions({});
  assert.equal(monitor.getTrackedSessionInfo(SESSION).dockerContainerName, NEXT);
  assert.equal(monitor.getActiveSessionCount(), 0);
  state.docker = 'running';
  await monitor.monitorSessions({});
  assert.equal(monitor.getTrackedSessionInfo(SESSION).paused, undefined);
  assert.equal(monitor.getActiveSessionCount(), 1);
  assert.equal((await monitor.getRunningTrackedIsolationSessions()).count, 1);
  assert.deepEqual(state.calls, []);
});

test('removed after a manual pause clears durable state without recovery or a duplicate launch', async t => {
  const { state } = setup({}, { docker: 'paused' });
  const dir = await temporary(t);
  const store = createSessionStore({ dir });
  monitor.setSessionStore(store);
  monitor.trackSession(SESSION, info());
  await monitor.monitorSessions({});
  assert.ok((await getProtectedTaskContainerNames(store)).has(SESSION));
  state.docker = 'removed';
  assert.match((await monitor.resumeStoppedSession(SESSION)).error, /removed/);
  assert.equal(monitor.getTrackedSessionInfo(SESSION).paused, undefined);
  await monitor.monitorSessions({ telegram: { sendMessage: async () => ({}) } }, false, { lookupLinkedPullRequest: async () => null });
  assert.deepEqual(state.calls, []);
  assert.equal((await store.load()).length, 0);
});

test('restart keeps a frozen task and /stop records intent before signalling it', async t => {
  const { state } = setup({}, { docker: 'paused' });
  const dir = await temporary(t);
  const store = createSessionStore({ dir });
  await store.persist(SESSION, info({ paused: true, pausedAt: WHEN, pauseCount: 1 }), { confirm: true });
  monitor.setSessionStore(store);
  const restored = await monitor.resumeTrackedSessions({ store });
  assert.equal(restored.resumed.length, 1);
  await monitor.monitorSessions({});
  assert.deepEqual(state.calls, []);
  assert.equal(monitor.getActiveSessionCount(), 0);
  assert.equal((await monitor.stopTrackedDockerSession(EXECUTION, { requestedBy: '@operator' })).success, true);
  assert.deepEqual(state.calls, [
    ['retain', SESSION],
    ['stop', EXECUTION],
  ]);
  const saved = (await store.load())[0].sessionInfo;
  assert.equal(saved.stopRequestedBy, '@operator');
  assert.equal(saved.paused, undefined);
});

test('a failed durable write prevents a stop or retained resume', async () => {
  const { state } = setup();
  monitor.trackSession(SESSION, info());
  monitor.setSessionStore({ persist: async () => false });
  assert.match((await monitor.stopTrackedDockerSession(SESSION)).error, /persist task state/);
  assert.equal(monitor.getTrackedSessionInfo(SESSION).stopRequestedByUser, undefined);
  state.docker = 'exited';
  assert.match((await monitor.resumeStoppedSession(SESSION)).error, /persist task state/);
  assert.equal(monitor.getTrackedSessionInfo(SESSION).explicitResumePending, undefined);
  assert.deepEqual(state.calls, []);
});

test('a live task remains paused when Docker refuses to stop it', async () => {
  const { state } = setup({ stopIsolatedSession: async () => ({ success: false, error: 'Docker refused the stop' }) }, { docker: 'paused' });
  monitor.trackSession(SESSION, info({ paused: true, pausedAt: WHEN }));
  assert.match((await monitor.stopTrackedDockerSession(SESSION)).error, /Docker refused the stop/);
  assert.equal(monitor.getTrackedSessionInfo(SESSION).paused, true);
  assert.equal(monitor.getTrackedSessionInfo(SESSION).stopRequestedByUser, undefined);
  assert.equal(state.docker, 'paused');
  assert.equal(monitor.getActiveSessionCount(), 0);
});

test('resume after stopping retains the clone, latest AI session and cumulative disk usage', async t => {
  const { state } = setup({}, { docker: 'exited' });
  const dir = await temporary(t);
  const store = createSessionStore({ dir: join(dir, 'bot') });
  const logPath = join(dir, 'task.log');
  await writeFile(logPath, 'Creating temporary directory: /tmp/original-clone\n📌 Session ID: first-session-123\n📌 Session ID: last-session-456\n');
  monitor.setSessionStore(store);
  monitor.trackSession(SESSION, info({ logPath, retainedForResume: true, completionNotifiedAt: WHEN, containerFilesystemInheritedBytes: 20, containerResourceLimits: { diskBytes: 1000 } }));
  assert.equal((await monitor.resumeStoppedSession(EXECUTION)).success, true);
  const [[verb, id, options]] = state.calls;
  assert.deepEqual([verb, id, options.requireRetained], ['resume', EXECUTION, true]);
  assert.match(options.command, /--working-directory.*\/tmp\/original-clone/);
  assert.match(options.command, /--resume.*last-session-456/);
  const [saved] = await store.load();
  assert.equal(saved.sessionName, NEXT);
  assert.equal(saved.sessionInfo.containerFilesystemInheritedBytes, 120);
  assert.equal(saved.sessionInfo.completionNotifiedAt, undefined);
  assert.equal((await store.load()).length, 1);
  assert.match((await monitor.resumeStoppedSession(SESSION)).error, /already running/);
});

test('interrupted resume adopts a replacement that has already exited', async t => {
  const { state } = setup({}, { docker: 'exited', count: 2, name: NEXT });
  const store = createSessionStore({ dir: await temporary(t) });
  await store.persist(SESSION, info({ explicitResumePending: { resumeCount: 1 }, retainedForResume: true, containerFilesystemLastBytes: 100 }), { confirm: true });
  monitor.setSessionStore(store);
  await monitor.resumeTrackedSessions({ store });
  await monitor.monitorSessions({});
  assert.deepEqual(state.calls, []);
  const [saved] = await store.load();
  assert.equal(saved.sessionName, NEXT);
  assert.equal(saved.sessionInfo.explicitResumePending, undefined);
  assert.equal(saved.sessionInfo.containerFilesystemInheritedBytes, 100);
});

test('a retained task occupies a queue slot while its resume is pending', async () => {
  setup({}, { docker: 'exited' });
  monitor.trackSession(SESSION, info({ retainedForResume: true, explicitResumePending: { resumeCount: 1 } }));
  assert.equal(monitor.getActiveSessionCount(), 1);
  const running = await monitor.getRunningTrackedIsolationSessions();
  assert.equal(running.byTool.codex, 1);
  const items = await monitor.getRunningSessionItems();
  assert.equal(items[0].status, 'resuming');
  assert.equal(mergeToolWork({ sessionItems: items, tools: ['codex'] }).total, 1);
});

test('stopping a solve preserves the workspace during signal cleanup with auto-cleanup enabled', async t => {
  const { cleanupTempDirectory } = await import('../src/solve.cleanup.lib.mjs');
  const dir = await temporary(t);
  const clone = join(dir, 'clone');
  const marker = join(dir, 'retain');
  await mkdir(clone);
  await writeFile(join(clone, 'uncommitted.txt'), 'work in progress');
  await writeFile(marker, '');
  await cleanupTempDirectory(clone, { autoCleanup: true }, false, { pauseMarkerPath: marker });
  assert.equal(await readFile(join(clone, 'uncommitted.txt'), 'utf8'), 'work in progress');
});

test('pause metadata is parsed from start-command status', () => {
  const result = parseSessionStatusOutput(JSON.stringify({ uuid: EXECUTION, status: 'paused', dockerState: 'paused', paused: true, pausedAt: WHEN, options: { sessionName: NEXT, isolated: 'docker', pauseCount: 2, pausedBy: '@requester', pauseReason: 'load', resumeCount: 1 } }));
  assert.deepEqual([result.sessionName, result.dockerState, result.paused, result.pausedAt, result.pauseCount, result.pausedBy, result.pauseReason, result.resumeCount], [NEXT, 'paused', true, WHEN, 2, '@requester', 'load', 1]);
});

test('Docker cleanup protects both a manually frozen task and a stopped retained task', () => {
  const containers = [
    { name: SESSION, status: 'Up 2 hours (Paused)', state: 'paused' },
    { name: NEXT, status: 'Exited (0) 1 hour ago', state: 'exited', retainForResume: true },
  ];
  const plan = planDockerIsolationCleanup({ mode: 'all', containers });
  assert.equal(plan.remove.length, 0);
});

test('one alert after the pause threshold and a live card after unpause', async () => {
  const calls = [];
  const bot = { telegram: { editMessageText: async (...args) => calls.push(['edit', args[3]]), sendMessage: async (...args) => calls.push(['send', args[1]]) } };
  const sessionInfo = info({ paused: true, pausedAt: WHEN, messageId: 7, locale: 'en' });
  const report = now => reportDockerPause({ bot, sessionName: SESSION, sessionInfo, running: true, now: () => now, persist: () => {} });
  await report(Date.parse(WHEN));
  await report(Date.parse(WHEN) + 3600000);
  await report(Date.parse(WHEN) + 7200000);
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['edit', 'send']
  );
  assert.match(calls[0][1], /Paused/);
  assert.match(calls[1][1], /\/unpause/);
  sessionInfo.paused = false;
  await report(Date.parse(WHEN) + 7200000);
  assert.doesNotMatch(calls[2][1], /Paused/);
});

test('Telegram resolves the configured names, URLs and replies and protects the requester', async () => {
  const received = [];
  const replies = [];
  const entry = { sessionName: NEXT, sessionInfo: info({ dockerContainerName: NEXT }) };
  const handlers = registerPauseResumeCommands(
    { command: () => {} },
    {
      isGroupChat: () => true,
      isChatAuthorized: id => id === -100,
      safeReply: async (_ctx, message) => replies.push(message),
      monitor: {
        getActiveSessions: () => [entry],
        findTrackedSessionByIdentifier: id => ([SESSION, NEXT, EXECUTION].includes(id) ? entry : null),
        findStoppableSessionByUrl: url => (url === TASK_URL ? entry : null),
        getDockerTaskControlState: async () => ({ success: true, state: 'paused' }),
        pauseTrackedSession: async (id, options) => {
          received.push([id, options.reason]);
          return { success: true, sessionId: id };
        },
      },
    }
  );
  const run = (handler, text, id = 42, chat = -100, owner = false, repliedTo) =>
    handler({
      chat: { id: chat, type: chat > 0 ? 'private' : 'supergroup' },
      from: { id },
      telegram: { getChatMember: async () => ({ status: owner ? 'creator' : 'member' }) },
      message: { text, reply_to_message: repliedTo },
    });
  await run(handlers.pause, `/pause@Hive ${NEXT} --reason CPU incident`);
  await run(handlers.pause, '/pause', 42, -100, false, { text: `Session ID: ${EXECUTION}` });
  await run(handlers.pause, `/pause ${TASK_URL}`, 99, 99, true);
  for (const chat of [-101, -100, 99]) await run(handlers.pause, `/pause ${TASK_URL}`, 99, chat);
  assert.deepEqual(received, [
    [NEXT, 'CPU incident'],
    [NEXT, undefined],
    [NEXT, undefined],
  ]);
  await run(handlers.unpause, '/unpause');
  assert.match(replies.at(-1), /Paused.*resume-1/);
});

test('guard refuses a fresh launch but forwards a snapshot-derived launch', async () => {
  const run = promisify(execFile);
  const shim = fileURLToPath(new URL('../src/docker-retained-resume/docker', import.meta.url));
  const env = { ...process.env, HIVE_MIND_RESUME_ORIGINAL_PATH: process.env.PATH, HIVE_MIND_RESUME_DOCKER_BIN: '/bin/echo' };
  await assert.rejects(run(shim, ['run', 'alpine:3.23'], { env }), /retained Docker container is missing/);
  assert.match((await run(shim, ['run', '--label', 'start-command.snapshot-image=start-command-resume/test:1', 'start-command-resume/test:1'], { env })).stdout, /^run --label/);
});

test('every UI locale has task controls and a pause confirmation that mentions RAM', async () => {
  for (const locale of ['en', 'ru', 'hi', 'zh']) {
    await loadTranslations(locale);
    assert.match(t('telegram.task_control_paused', { session: SESSION }, { locale }), /RAM|память/i);
    assert.match(t('telegram.help_pause_resume', {}, { locale }), /\/unpause/);
  }
});
