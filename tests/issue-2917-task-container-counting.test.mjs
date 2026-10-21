#!/usr/bin/env node
/**
 * Issue #2917: `/limits` and the dispatch throttling count running task
 * containers, not only what this bot process remembers.
 *
 * Covers:
 * - `hive-mind.*` labels on every docker task launch
 * - `docker ps` parsing and per-tool attribution (labels, `$ --list`, tracked ids)
 * - the queue snapshot uses max(processes, tracked sessions, containers) per tool,
 *   ignores the host pgrep count under docker isolation and shows untracked tasks
 * - a container `$ --status` reports as `executed` still counts while it runs
 * - one-at-a-time dispatch waits while an untracked container runs
 * - untracked containers are adopted into the session registry once
 * - the queue head and the kill-recovery resource gate use the effective count
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2917
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildTaskContainerLabelArgs, buildTaskContainerLabels, extractTaskUrl, resolveBotInstanceId, sanitizeLabelValue } from '../src/task-container-labels.lib.mjs';
import { attributeTaskContainers, configureTaskContainerSource, DOCKER_PS_FORMAT, getTaskContainerSnapshot, invalidateTaskContainerSnapshot, isTaskContainerName, listRunningContainers, mergeTaskContainerCounts, parseDockerCreatedAt, parseDockerPsOutput, summarizeTaskContainers, toTrackedIdentities } from '../src/task-container-inventory.lib.mjs';
import { adoptUntrackedTaskContainers, buildAdoptedSessionInfo, planContainerAdoptions, startTaskContainerAdoption } from '../src/task-container-adoption.lib.mjs';
import { buildDockerIsolationStartArgs } from '../src/isolation-runner.lib.mjs';
import { SolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { CACHE_TTL, getLimitCache, resetLimitCache } from '../src/limits.lib.mjs';
import { listTrackedSessionEntries, trackSession, untrackSession } from '../src/session-monitor.lib.mjs';
import { createQueueRecoveryResourceGate } from '../src/session-kill-resume.resource-gate.lib.mjs';

const ISSUE_URL = 'https://github.com/link-assistant/hive-mind/issues/2917';
const TASK = '0f9b6c2e-3d4a-4b5c-8d6e-7f8091a2b3c4';
const OTHER = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const NOW = Date.parse('2026-10-09T15:00:00Z');

/** One `docker ps --format DOCKER_PS_FORMAT` line. */
function psLine({ name, createdAt = '2026-10-09 14:00:00 +0000 UTC', tool = '', command = '', url = '', session = '', instance = '', scSession = '', scRootSession = '', scUuid = '' }) {
  const value = v => (v === '' ? '<no value>' : v);
  return [name, createdAt, value(tool), value(command), value(url), value(session), value(instance), value(scSession), value(scRootSession), value(scUuid)].join('\t');
}

const idleProcesses = async () => ({ count: 0, processes: [] });
const noIsolated = async () => ({ count: 0, sessions: [], byTool: {} });

test('labels: a docker task carries tool, command, URL, session and instance labels', () => {
  const args = buildTaskContainerLabelArgs({ tool: 'codex', command: '/usr/local/bin/solve', args: [ISSUE_URL, '--tool', 'codex'], sessionId: TASK, env: { HIVE_MIND_INSTANCE_ID: 'bot-a' } });
  assert.deepEqual(args, ['--label', 'hive-mind.tool=codex', '--label', 'hive-mind.command=solve', '--label', `hive-mind.url=${ISSUE_URL}`, '--label', `hive-mind.session=${TASK}`, '--label', 'hive-mind.instance=bot-a']);
  assert.equal(extractTaskUrl(['--model', 'opus', ` ${ISSUE_URL} `]), ISSUE_URL);
  assert.equal(sanitizeLabelValue('a\nb\tc'), 'a b c');
  assert.equal(
    resolveBotInstanceId({}, () => 'host-1'),
    'host-1'
  );
  assert.equal(
    resolveBotInstanceId({ HIVE_MIND_INSTANCE_ID: ' named ' }, () => 'host-1'),
    'named'
  );
  const labels = buildTaskContainerLabels({ tool: 'claude', command: 'solve', args: [], sessionId: null, instanceId: 'x' });
  assert.equal(labels['hive-mind.url'], undefined, 'empty values are left out');
  assert.equal(labels['hive-mind.session'], undefined);
  assert.ok(
    Object.keys(labels).every(key => !key.startsWith('start-command.')),
    'start-command.* keys are reserved by start-command'
  );
});

test('labels: buildDockerIsolationStartArgs passes the labels before --detached', async () => {
  const startArgs = await buildDockerIsolationStartArgs('solve', [ISSUE_URL, '--tool', 'codex'], { sessionId: TASK, tool: 'codex', env: { HIVE_MIND_INSTANCE_ID: 'bot-a' }, homeDir: '/home/box', existsSync: () => false });
  const detached = startArgs.indexOf('--detached');
  const label = value => startArgs.findIndex((arg, index) => arg === value && startArgs[index - 1] === '--label');
  for (const value of ['hive-mind.tool=codex', 'hive-mind.command=solve', `hive-mind.url=${ISSUE_URL}`, `hive-mind.session=${TASK}`, 'hive-mind.instance=bot-a']) {
    const index = label(value);
    assert.ok(index > 0, `${value} is passed with --label`);
    assert.ok(index < detached, `${value} comes before --detached (a start-command option, not part of the task command)`);
  }
});

test('docker ps: parses names, creation time and labels', () => {
  assert.equal(parseDockerCreatedAt('2026-10-09 14:32:01 +0000 UTC'), Date.parse('2026-10-09T14:32:01Z'));
  assert.equal(parseDockerCreatedAt('2026-10-09 17:32:01 +0300 MSK'), Date.parse('2026-10-09T14:32:01Z'));
  assert.equal(parseDockerCreatedAt('garbage'), null);
  const stdout = [psLine({ name: TASK, tool: 'codex', command: 'solve', url: ISSUE_URL, session: TASK, instance: 'bot-a', scSession: TASK, scRootSession: TASK, scUuid: 'exec-1' }), psLine({ name: 'hive-mind-router' }), ''].join('\n');
  const [first, second] = parseDockerPsOutput(stdout);
  assert.equal(first.name, TASK);
  assert.equal(first.tool, 'codex');
  assert.equal(first.url, ISSUE_URL);
  assert.equal(first.scUuid, 'exec-1');
  assert.equal(first.createdAtMs, Date.parse('2026-10-09T14:00:00Z'));
  assert.equal(second.tool, null, '<no value> means the label is absent');
  assert.ok(DOCKER_PS_FORMAT.includes('{{.Label "hive-mind.tool"}}'));
  assert.ok(isTaskContainerName(TASK));
  assert.ok(isTaskContainerName(`${TASK}-resume-2`));
  assert.ok(!isTaskContainerName('hive-mind-router'));
});

test('docker ps: a failing docker yields null, never an exception', async () => {
  assert.equal(
    await listRunningContainers({
      run: async () => {
        throw new Error('Cannot connect to the Docker daemon');
      },
    }),
    null
  );
  const listed = await listRunningContainers({ run: async args => (args.join(' ').startsWith('ps --format') ? psLine({ name: TASK, tool: 'claude' }) : '') });
  assert.equal(listed.length, 1);
});

test('attribution: labels, `$ --list` records and tracked ids (resume family)', () => {
  const containers = parseDockerPsOutput(
    [
      psLine({ name: TASK, tool: 'codex', url: ISSUE_URL }), // labelled, untracked
      psLine({ name: OTHER }), // pre-label task container, known to `$ --list`
      psLine({ name: `${'2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d'}-resume-1`, scRootSession: '2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d' }), // a resumed tracked task
      psLine({ name: '3c4d5e6f-7081-4b9c-8d0e-1f2a3b4c5d6e' }), // a non-task `$ --isolated docker` run
      psLine({ name: 'hive-mind-formal-ai' }), // sidecar
    ].join('\n')
  );
  const attributed = attributeTaskContainers({
    containers,
    sessionRecords: [
      { uuid: 'exec-2', sessionName: OTHER, command: `solve ${ISSUE_URL} --tool qwen`, status: 'executing' },
      { uuid: 'exec-3', sessionName: '3c4d5e6f-7081-4b9c-8d0e-1f2a3b4c5d6e', command: 'bash -lc "sleep 1000"', status: 'executing' },
    ],
    trackedIdentities: [{ sessionName: 'tracked-1', tool: 'claude', url: ISSUE_URL, ids: ['tracked-1', '2b3c4d5e-6f70-4a8b-9c0d-1e2f3a4b5c6d'] }],
  });
  assert.deepEqual(
    attributed.map(c => [c.name.slice(0, 8), c.tool, c.source, c.tracked]),
    [
      ['0f9b6c2e', 'codex', 'label', false],
      ['1a2b3c4d', 'qwen', 'session-list', false],
      ['2b3c4d5e', 'claude', 'tracked', true],
    ]
  );
  assert.equal(attributed[1].executionUuid, 'exec-2');
  assert.deepEqual(summarizeTaskContainers(attributed), { byTool: { codex: 1, qwen: 1, claude: 1 }, untrackedByTool: { codex: 1, qwen: 1 }, total: 3, untrackedTotal: 2 });
});

test('merge: max per tool, docker ignores host pgrep, a null source keeps the old values', () => {
  const base = { byTool: { claude: 5, codex: 4 }, processByTool: { claude: 5, codex: 2 }, isolatedByTool: { claude: 1, codex: 4 }, total: 7, isolatedTotal: 5, processTotal: 7 };
  const unchanged = mergeTaskContainerCounts(base, null, ['claude', 'codex']);
  assert.deepEqual(unchanged.byTool, base.byTool);
  assert.equal(unchanged.total, 7);
  assert.deepEqual(unchanged.untrackedByTool, {});

  const screen = mergeTaskContainerCounts(base, { byTool: { codex: 6 }, untrackedByTool: { codex: 2 }, total: 6, untrackedTotal: 2, ignoreProcessCounts: false }, ['claude', 'codex']);
  assert.equal(screen.byTool.claude, 5);
  assert.equal(screen.byTool.codex, 6);
  assert.equal(screen.untrackedByTool.codex, 2);
  assert.equal(screen.total, 11);

  const docker = mergeTaskContainerCounts(base, { byTool: { codex: 3 }, untrackedByTool: {}, total: 3, untrackedTotal: 0, ignoreProcessCounts: true }, ['claude', 'codex']);
  assert.equal(docker.byTool.claude, 1, 'under docker isolation the AI CLI never runs in the bot container, so pgrep is not counted');
  assert.equal(docker.byTool.codex, 4);
});

test('queue: an untracked running container counts and /limits says so', async () => {
  const queue = new SolveQueue({
    verbose: false,
    getRunningProcesses: idleProcesses,
    getRunningIsolatedSessions: async () => ({ count: 2, sessions: ['a', 'b'], byTool: { codex: 2 } }),
    getTaskContainerSnapshot: async () => ({ byTool: { codex: 4 }, untrackedByTool: { codex: 2 }, total: 4, untrackedTotal: 2, containers: [], ignoreProcessCounts: true }),
  });
  try {
    const snapshot = await queue.getExternalProcessingSnapshot(['claude', 'codex']);
    assert.equal(snapshot.byTool.codex, 4);
    assert.equal(snapshot.total, 4);
    const status = await queue.formatStatus();
    assert.ok(status.includes('codex (pending: 0, processing: 4, 2 untracked)'), status);
    assert.ok(status.includes('claude (pending: 0, processing: 0)'), status);
  } finally {
    queue.stop();
  }
});

test('queue: a task `$ --status` reports as executed still counts while its container runs', async () => {
  const queue = new SolveQueue({
    verbose: false,
    getRunningProcesses: idleProcesses,
    getRunningIsolatedSessions: noIsolated, // `$ --status` says executed
    getTaskContainerSnapshot: async () => ({ byTool: { claude: 1 }, untrackedByTool: {}, total: 1, untrackedTotal: 0, containers: [], ignoreProcessCounts: true }),
  });
  try {
    const snapshot = await queue.getExternalProcessingSnapshot(['claude']);
    assert.equal(snapshot.byTool.claude, 1);
    assert.equal(snapshot.total, 1);
  } finally {
    queue.stop();
  }
});

test('queue: a throwing container source falls back to the other sources', async () => {
  const queue = new SolveQueue({
    verbose: false,
    getRunningProcesses: async tool => ({ count: tool === 'claude' ? 2 : 0, processes: [] }),
    getRunningIsolatedSessions: noIsolated,
    getTaskContainerSnapshot: () => {
      throw new Error('boom');
    },
  });
  try {
    const snapshot = await queue.getExternalProcessingSnapshot(['claude']);
    assert.equal(snapshot.byTool.claude, 2);
  } finally {
    queue.stop();
  }
});

test('queue: one-at-a-time dispatch waits while an untracked codex container runs', async () => {
  resetLimitCache();
  getLimitCache().set('codex', { success: true, usage: { currentSession: { percentage: 95, resetTime: null, resetsAt: null }, allModels: { percentage: 10, resetTime: null, resetsAt: null } }, planType: 'pro', additionalRateLimits: [], credits: null }, CACHE_TTL.USAGE_API);
  const running = new SolveQueue({
    verbose: false,
    getRunningProcesses: idleProcesses,
    getRunningIsolatedSessions: noIsolated,
    getTaskContainerSnapshot: async () => ({ byTool: { codex: 1 }, untrackedByTool: { codex: 1 }, total: 1, untrackedTotal: 1, containers: [], ignoreProcessCounts: true }),
  });
  const idle = new SolveQueue({ verbose: false, getRunningProcesses: idleProcesses, getRunningIsolatedSessions: noIsolated, getTaskContainerSnapshot: async () => null });
  try {
    const blocked = await running.canStartCommand({ tool: 'codex' });
    assert.equal(blocked.canStart, false);
    assert.equal(blocked.codexProcesses, 1);
    assert.ok(
      blocked.reasons.some(reason => reason.includes('Codex 5 hour session limit') && reason.includes('waiting for current command')),
      blocked.reasons.join(' | ')
    );
    const free = await idle.canStartCommand({ tool: 'codex' });
    assert.ok(!free.reasons.some(reason => reason.includes('Codex 5 hour session limit') && reason.includes('waiting for current command')), 'without a running codex task the limit does not hold the queue');
  } finally {
    running.stop();
    idle.stop();
    resetLimitCache();
  }
});

test('source: off by default, cached, shared in flight and attributed against tracked sessions', async () => {
  assert.equal(await getTaskContainerSnapshot(), null, 'other processes and tests leave the source off');
  let calls = 0;
  let clock = NOW;
  configureTaskContainerSource({
    enabled: true,
    backend: 'docker',
    now: () => clock,
    run: async () => {
      calls += 1;
      return [psLine({ name: TASK, tool: 'codex' }), psLine({ name: OTHER, tool: 'claude' })].join('\n');
    },
    listTrackedIdentities: () => [{ sessionName: OTHER, tool: 'claude', ids: [OTHER] }],
  });
  try {
    const [a, b] = await Promise.all([getTaskContainerSnapshot(), getTaskContainerSnapshot()]);
    assert.equal(calls, 1, 'concurrent callers share one docker ps');
    assert.equal(a, b);
    assert.deepEqual(a.byTool, { codex: 1, claude: 1 });
    assert.deepEqual(a.untrackedByTool, { codex: 1 });
    assert.equal(a.ignoreProcessCounts, true);
    await getTaskContainerSnapshot();
    assert.equal(calls, 1, 'cached within the TTL');
    clock += 60_000;
    await getTaskContainerSnapshot();
    assert.equal(calls, 2);
    invalidateTaskContainerSnapshot();
    await getTaskContainerSnapshot();
    assert.equal(calls, 3);
  } finally {
    configureTaskContainerSource({ enabled: false, backend: null, run: null, listTrackedIdentities: null, now: Date.now });
  }
});

test('session registry: tracked identities include the container family', () => {
  const name = `tracked-2917-${Date.now()}`;
  trackSession(name, { chatId: 1, url: ISSUE_URL, tool: 'codex', isolationBackend: 'docker', sessionId: TASK, executionUuid: 'exec-9', containerName: `${TASK}-resume-1`, startTime: new Date() });
  try {
    const identity = toTrackedIdentities(listTrackedSessionEntries()).find(entry => entry.sessionName === name);
    assert.ok(identity);
    assert.equal(identity.tool, 'codex');
    for (const id of [name, TASK, 'exec-9', `${TASK}-resume-1`]) assert.ok(identity.ids.includes(id), id);
  } finally {
    untrackSession(name);
  }
});

test('adoption: untracked containers are tracked once, after the launch grace, with adopted:true', async () => {
  const container = { name: TASK, tool: 'codex', url: ISSUE_URL, command: 'solve', scSession: TASK, scRootSession: TASK, scUuid: 'exec-1', createdAtMs: NOW - 10 * 60_000, source: 'label', tracked: false, instance: 'bot-a' };
  const fresh = { ...container, name: OTHER, scSession: OTHER, createdAtMs: NOW - 5_000 };
  const foreign = { ...container, name: '4d5e6f70-8192-4a0b-8c1d-2e3f4a5b6c7d', scSession: null, instance: 'bot-b' };
  const tracked = { ...container, name: '5e6f7081-92a3-4b1c-8d2e-3f4a5b6c7d8e', tracked: true };
  const snapshot = { containers: [container, fresh, foreign, tracked] };
  const calls = [];
  const events = [];
  const adoptedBefore = new Set();
  const options = { trackSession: (sessionName, info) => calls.push([sessionName, info]), getSnapshot: async () => snapshot, now: () => NOW, env: { HIVE_MIND_INSTANCE_ID: 'bot-a' }, adoptedBefore, logger: { event: (type, data) => events.push([type, data]) } };

  const first = await adoptUntrackedTaskContainers(options);
  assert.deepEqual(first.adopted, [TASK]);
  assert.deepEqual(first.skipped.map(s => s.reason).sort(), ['launch-grace', 'other-instance']);
  const [sessionName, info] = calls[0];
  assert.equal(sessionName, TASK);
  assert.equal(info.adopted, true);
  assert.equal(info.chatId, null);
  assert.equal(info.tool, 'codex');
  assert.equal(info.url, ISSUE_URL);
  assert.equal(info.isolationBackend, 'docker');
  assert.equal(info.sessionId, TASK);
  assert.equal(info.executionUuid, 'exec-1');
  assert.equal(info.startTime.getTime(), NOW - 10 * 60_000);
  assert.equal(events[0][0], 'task_container_adopted');

  const second = await adoptUntrackedTaskContainers(options);
  assert.deepEqual(second.adopted, [], 'a container adopted earlier is not adopted again (even if reported finished while running)');
  assert.equal(calls.length, 1);

  // Without a named instance every bot on the daemon has a different host name, so the instance label is not an owner check.
  const unnamed = planContainerAdoptions({ containers: [foreign], now: NOW, instanceId: 'host-1', ownInstanceOnly: false });
  assert.equal(unnamed.adopt.length, 1);
  assert.equal(buildAdoptedSessionInfo({ name: OTHER, createdAtMs: null }, { instanceId: 'x', now: NOW }).sessionInfo.tool, 'claude');
});

test('adoption: never throws and the timer is unref-ed and stoppable', async () => {
  const result = await adoptUntrackedTaskContainers({
    trackSession: () => {
      throw new Error('registry down');
    },
    getSnapshot: async () => ({ containers: [{ name: TASK, tool: 'claude', createdAtMs: NOW - 600_000, tracked: false }] }),
    now: () => NOW,
    env: {},
  });
  assert.deepEqual(result.adopted, []);
  assert.deepEqual(await adoptUntrackedTaskContainers({ trackSession: () => {}, getSnapshot: async () => null }), { adopted: [], skipped: [] });

  let unrefed = false;
  let cleared = null;
  const timer = { unref: () => (unrefed = true) };
  let runs = 0;
  const handle = startTaskContainerAdoption({
    intervalMs: 1000,
    setIntervalFn: () => timer,
    clearIntervalFn: value => (cleared = value),
    trackSession: () => {},
    getSnapshot: async () => {
      runs += 1;
      return { containers: [] };
    },
  });
  await handle.runOnce();
  assert.ok(runs >= 1, 'runs once at start');
  assert.equal(unrefed, true);
  handle.stop();
  assert.equal(cleared, timer);
});

test('effective count: max(own launches, observed) per tool', () => {
  const queue = new SolveQueue({ verbose: false, getRunningProcesses: idleProcesses, getRunningIsolatedSessions: noIsolated, getTaskContainerSnapshot: async () => null });
  try {
    queue.processing.set('x', { tool: 'codex' });
    assert.equal(queue.getEffectiveProcessingCountByTool('codex', null), 1);
    assert.equal(queue.getEffectiveProcessingCountByTool('codex', { byTool: { codex: 3 } }), 3);
    assert.equal(queue.getEffectiveProcessingCountByTool('claude', { byTool: { codex: 3 } }), 0);
    queue.lastExternalProcessingSnapshot = { byTool: { claude: 2 } };
    assert.equal(queue.getEffectiveProcessingCountByTool('claude'), 2, 'defaults to the last snapshot');
  } finally {
    queue.stop();
  }
});

test('recovery resource gate: one-at-a-time holds a recovery while an untracked container of the tool runs', async () => {
  const queue = new SolveQueue({
    verbose: false,
    getRunningProcesses: idleProcesses,
    getRunningIsolatedSessions: noIsolated,
    getTaskContainerSnapshot: async () => ({ byTool: { claude: 1 }, untrackedByTool: { claude: 1 }, total: 1, untrackedTotal: 1, containers: [], ignoreProcessCounts: true }),
  });
  // Only the strategy matters here: canStart with one_at_a_time pressure.
  queue.canStartCommand = async options => {
    await queue.getExternalProcessingSnapshot([options.tool]);
    return { canStart: true, oneAtATime: true, reasons: [] };
  };
  try {
    assert.equal(queue.getProcessingCountByTool('claude'), 0, 'the queue itself launched nothing');
    const gate = createQueueRecoveryResourceGate(() => queue);
    const result = await gate.check({ tool: 'claude' });
    assert.equal(result.canStart, false);
    assert.match(result.reasons[0], /one-at-a-time: 1 claude task/);
    const codex = await gate.check({ tool: 'codex' });
    assert.equal(codex.canStart, true, 'another tool is not held');
  } finally {
    queue.stop();
  }
});

test('labels: the caller-supplied task URL wins over the args', async () => {
  const startArgs = await buildDockerIsolationStartArgs('solve', ['--resume', 'x'], { sessionId: TASK, tool: 'claude', taskUrl: ISSUE_URL, env: { HIVE_MIND_INSTANCE_ID: 'bot-a' }, homeDir: '/home/box', existsSync: () => false });
  assert.ok(startArgs.includes(`hive-mind.url=${ISSUE_URL}`), startArgs.join(' '));
});

test('a recovery report of an adopted container (no chat) sends nothing and is not retried', async () => {
  const { reportRecoveryLifecycle } = await import('../src/session-recovery-lifecycle.lib.mjs');
  const calls = [];
  const bot = { telegram: { sendMessage: async (...args) => (calls.push(args), { message_id: 1 }), editMessageText: async (...args) => (calls.push(args), true) } };
  const sessionInfo = { chatId: null, messageId: null, adopted: true, tool: 'codex', startTime: new Date('2026-10-09T13:31:00Z'), killRecoveryResumed: true, killRecoveryAttempts: 1 };
  await reportRecoveryLifecycle({ bot, sessionName: 'solve-adopted', sessionInfo, phase: 'waiting-resources', attempt: 1, maxAttempts: 3, resourceState: 'blocked', options: { recoveryNow: () => Date.parse('2026-10-09T13:40:00Z') } });
  assert.equal(calls.length, 0, 'no Telegram call for a session without a chat');
  assert.ok(sessionInfo.recoveryLifecycle?.lastReportedMs > 0, 'the report counts as delivered, so it is not retried every tick');
});
