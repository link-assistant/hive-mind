#!/usr/bin/env node
/**
 * Issue #2917: `/limits` showed `codex (pending: 0, processing: 0)` while four
 * docker-isolated codex tasks were running — they had been resumed by an
 * operator `$ --resume` after a dockerd OOM, so the bot's in-memory registry did
 * not know them, and pgrep (bot's PID namespace) cannot see a container's AI
 * CLI. Dispatch throttling used the same zero.
 *
 * These tests pin the ground-truth container source, its reconciliation with
 * the tracked sessions, the `/limits` rendering and the dispatch decision.
 *
 * Run with: node tests/test-issue-2917-docker-task-containers.mjs
 */

import assert from 'node:assert/strict';
import { buildTaskContainerMarkerEnv, collectTrackedSessionIdentities, countTaskContainersByTool, createCachedTaskContainerSource, detectTaskToolFromCommand, findRunningResumeDescendant, getRootSessionName, isResumeDescendantName, listRunningTaskContainers, partitionTaskContainers, parseTaskContainers } from '../src/docker-task-containers.lib.mjs';
import { mergeExternalProcessingSnapshot } from '../src/telegram-solve-queue.external.lib.mjs';
import { SolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { CACHE_TTL, getLimitCache, resetLimitCache } from '../src/limits.lib.mjs';
import { initI18n, preloadAllLocales } from '../src/i18n.lib.mjs';

await initI18n('en');
await preloadAllLocales();

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   ${error.stack || error.message}`);
    failed++;
  }
}

const UUID = 'd6bd0b51-5c43-4b6e-9d0f-2f0c1a1e7a24';
const UUID_2 = '1f2e3d4c-5b6a-4789-8abc-def012345678';
const UUID_3 = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const UUID_4 = '9f8e7d6c-5b4a-4398-8786-a5b4c3d2e1f0';

// Shape of `docker inspect` for the containers from the incident: resumed by
// `$ --resume`, so named `<uuid>-resume-<n>` and carrying no hive-mind env
// marker (they predate it) — only the solve command identifies them.
function inspectEntry({ name, env = [], cmd = [], running = true, image = 'konard/hive-mind:latest' }) {
  return {
    Id: `${name}-id`,
    Name: `/${name}`,
    State: { Running: running, StartedAt: '2026-10-09T12:00:00Z' },
    Config: { Env: ['PATH=/usr/bin', ...env], Cmd: cmd, Image: image },
    Path: cmd[0] || '',
    Args: cmd.slice(1),
  };
}
const codexCmd = url => ['/bin/bash', '-c', `solve ${url} --tool codex --attach-logs --verbose`];
const incidentContainers = [inspectEntry({ name: `${UUID}-resume-1`, cmd: codexCmd('https://github.com/link-assistant/router/issues/724') }), inspectEntry({ name: `${UUID_2}-resume-1-resume-2`, cmd: codexCmd('https://github.com/link-assistant/router/issues/725') }), inspectEntry({ name: `${UUID_3}-resume-1`, cmd: codexCmd('https://github.com/link-assistant/router/issues/727') }), inspectEntry({ name: `${UUID_4}-resume-1`, cmd: codexCmd('https://github.com/link-assistant/router/issues/728') })];

await test('marker env carries tool and http(s) task URL only', () => {
  assert.deepEqual(buildTaskContainerMarkerEnv({ tool: 'Codex', url: 'https://github.com/o/r/issues/1' }), { HIVE_MIND_TOOL: 'codex', HIVE_MIND_TASK_URL: 'https://github.com/o/r/issues/1' });
  assert.deepEqual(buildTaskContainerMarkerEnv({ tool: 'claude', url: '--dry-run' }), { HIVE_MIND_TOOL: 'claude' });
  assert.deepEqual(buildTaskContainerMarkerEnv({ tool: 'bad\nvalue' }), {});
});

await test('resume names map back to their root session', () => {
  assert.equal(getRootSessionName(`/${UUID}-resume-1-resume-2`), UUID);
  assert.equal(getRootSessionName(UUID), UUID);
  assert.equal(isResumeDescendantName(`${UUID}-resume-3`, UUID), true);
  assert.equal(isResumeDescendantName(`${UUID}-resume-1-resume-2`, `${UUID}-resume-1`), true);
  assert.equal(isResumeDescendantName(UUID, UUID), false);
  assert.equal(isResumeDescendantName(`${UUID_2}-resume-1`, UUID), false);
});

await test('tool is detected from the task command (default claude)', () => {
  assert.equal(detectTaskToolFromCommand('solve https://github.com/o/r/issues/1 --tool codex'), 'codex');
  assert.equal(detectTaskToolFromCommand("'solve' 'https://github.com/o/r/issues/1' '--tool' 'agent'"), 'agent');
  assert.equal(detectTaskToolFromCommand('solve https://github.com/o/r/issues/1 --tool=qwen'), 'qwen');
  assert.equal(detectTaskToolFromCommand('solve https://github.com/o/r/issues/1'), 'claude');
  assert.equal(detectTaskToolFromCommand('nginx -g daemon off;'), null);
});

await test('incident containers are attributed from their command', () => {
  const containers = parseTaskContainers(incidentContainers);
  assert.equal(containers.length, 4);
  assert.deepEqual(
    containers.map(c => c.tool),
    ['codex', 'codex', 'codex', 'codex']
  );
  assert.equal(containers[1].rootSessionName, UUID_2);
  assert.equal(containers[0].url, 'https://github.com/link-assistant/router/issues/724');
  assert.equal(containers[0].toolSource, 'command');
});

await test('env markers win and unrelated/stopped containers are ignored', () => {
  const containers = parseTaskContainers([inspectEntry({ name: UUID, env: ['HIVE_MIND_TOOL=agent', 'HIVE_MIND_TASK_URL=https://github.com/o/r/pull/9', 'HIVE_MIND_PARENT_SESSION_ID=bot-1'], cmd: ['/bin/bash', '-c', 'solve x --tool codex'] }), inspectEntry({ name: 'postgres', cmd: ['postgres'] }), inspectEntry({ name: UUID_2, cmd: ['nginx'] }), inspectEntry({ name: UUID_3, cmd: codexCmd('https://github.com/o/r/issues/2'), running: false })]);
  assert.equal(containers.length, 1);
  assert.equal(containers[0].tool, 'agent');
  assert.equal(containers[0].toolSource, 'env');
  assert.equal(containers[0].url, 'https://github.com/o/r/pull/9');
  assert.equal(containers[0].parentSessionId, 'bot-1');
});

await test('listRunningTaskContainers uses docker ps + inspect and never throws', async () => {
  const calls = [];
  const execFileImpl = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (args[0] === 'ps') return { stdout: 'a\nb\n' };
    return { stdout: JSON.stringify(incidentContainers.slice(0, 2)) };
  };
  const result = await listRunningTaskContainers({ execFileImpl });
  assert.equal(result.available, true);
  assert.equal(result.containers.length, 2);
  assert.match(calls[0], /^docker ps --quiet --no-trunc --filter status=running$/);
  assert.match(calls[1], /^docker inspect a b$/);

  const none = await listRunningTaskContainers({ execFileImpl: async () => ({ stdout: '' }) });
  assert.deepEqual(none, { available: true, containers: [] });

  const broken = await listRunningTaskContainers({
    execFileImpl: async () => {
      throw Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' });
    },
  });
  assert.equal(broken.available, false);
  assert.deepEqual(broken.containers, []);
});

await test('cached container source dedupes calls within the TTL', async () => {
  let clock = 0;
  let calls = 0;
  const source = createCachedTaskContainerSource({ ttlMs: 1000, now: () => clock, list: async () => ({ available: true, containers: [{ n: ++calls }] }) });
  const [a, b] = await Promise.all([source(), source()]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  clock = 500;
  await source();
  assert.equal(calls, 1);
  clock = 1500;
  await source();
  assert.equal(calls, 2);
  source.invalidate();
  await source();
  assert.equal(calls, 3);
});

await test('tracked identities match containers by name, root or parent', () => {
  const containers = parseTaskContainers(incidentContainers);
  const identities = collectTrackedSessionIdentities([
    [`${UUID}-resume-1`, { sessionName: `${UUID}-resume-1` }],
    [UUID_2, {}],
  ]);
  const { tracked, untracked } = partitionTaskContainers(containers, identities);
  assert.deepEqual(
    tracked.map(c => c.rootSessionName),
    [UUID, UUID_2]
  );
  assert.equal(untracked.length, 2);
  assert.deepEqual(countTaskContainersByTool(untracked), { codex: 2 });
  assert.equal(findRunningResumeDescendant(UUID_2, containers)?.name, `${UUID_2}-resume-1-resume-2`);
  assert.equal(findRunningResumeDescendant(UUID_2, []), null);
});

await test('issue scenario: nothing tracked, four codex containers → processing 4, 4 untracked', () => {
  const snapshot = mergeExternalProcessingSnapshot({
    tools: ['claude', 'codex'],
    processByTool: { claude: 0, codex: 0 },
    isolated: { count: 0, byTool: {}, dockerByTool: {}, identities: [] },
    containerResult: { available: true, containers: parseTaskContainers(incidentContainers) },
  });
  assert.equal(snapshot.byTool.codex, 4);
  assert.equal(snapshot.byTool.claude, 0);
  assert.equal(snapshot.untrackedByTool.codex, 4);
  assert.equal(snapshot.total, 4);
});

await test('a tracked docker session and its container count once; screen sessions add', () => {
  const containers = parseTaskContainers(incidentContainers.slice(0, 1));
  const snapshot = mergeExternalProcessingSnapshot({
    tools: ['codex'],
    processByTool: { codex: 0 },
    // one tracked docker codex session (the container above) + one screen codex session
    isolated: { count: 2, byTool: { codex: 2 }, dockerByTool: { codex: 1 }, identities: [`${UUID}-resume-1`] },
    containerResult: { available: true, containers },
  });
  assert.equal(snapshot.byTool.codex, 2);
  assert.equal(snapshot.untrackedTotal, 0);
  assert.equal(snapshot.total, 2);
});

await test('tracked session whose $ --status went stale still counts (container is running)', () => {
  // `$ --status` reported `executed 137` (link-foundation/start#193), so the
  // tracked-sessions source drops it — the running container keeps it counted.
  const snapshot = mergeExternalProcessingSnapshot({
    tools: ['codex'],
    processByTool: { codex: 0 },
    isolated: { count: 0, byTool: {}, dockerByTool: {}, identities: [UUID] },
    containerResult: { available: true, containers: parseTaskContainers([inspectEntry({ name: UUID, cmd: codexCmd('https://github.com/o/r/issues/5') })]) },
  });
  assert.equal(snapshot.byTool.codex, 1);
  assert.equal(snapshot.untrackedTotal, 0, 'the session is known, just mis-reported');
});

await test('unavailable docker falls back to the previous max(pgrep, tracked) behavior', () => {
  const snapshot = mergeExternalProcessingSnapshot({
    tools: ['claude', 'codex'],
    processByTool: { claude: 5, codex: 2 },
    isolated: { count: 4, byTool: { claude: 1, codex: 4 } },
    containerResult: { available: false, containers: [] },
  });
  assert.deepEqual(snapshot.byTool, { claude: 5, codex: 4 });
  assert.equal(snapshot.total, 7);
  assert.equal(snapshot.containersAvailable, false);
});

function createQueue() {
  resetLimitCache();
  return new SolveQueue({
    verbose: false,
    autoStart: false,
    getRunningProcesses: async () => ({ count: 0 }),
    getRunningIsolatedSessions: async () => ({ count: 0, byTool: {}, dockerByTool: {}, identities: [] }),
    getRunningTaskContainers: async () => ({ available: true, containers: parseTaskContainers(incidentContainers) }),
  });
}

await test('/limits renders the container count and the untracked suffix', async () => {
  const queue = createQueue();
  const status = await queue.formatStatus();
  assert.match(status, /codex \(pending: 0, processing: 4, 4 untracked\)/);
  assert.match(status, /claude \(pending: 0, processing: 0\)\n/);
  const ru = await queue.formatStatus({ locale: 'ru' });
  assert.match(ru, /codex \(ожидает: 0, выполняется: 4, неотслеживаемых: 4\)/);
});

await test('an untracked codex container blocks one-at-a-time codex dispatch', async () => {
  const queue = createQueue();
  queue.checkSystemResources = async () => ({ ok: true, reasons: [], oneAtATime: false, rejected: false, rejectReason: null });
  // Codex 5h session at 70% ≥ 65% default threshold → 'dequeue-one-at-a-time'.
  getLimitCache().set('codex', { success: true, usage: { currentSession: { percentage: 70 }, allModels: { percentage: 10 } } }, CACHE_TTL.USAGE_API);
  getLimitCache().set('github', { success: true, githubRateLimit: { usedPercentage: 1 } }, CACHE_TTL.API);
  const check = await queue.canStartCommand({ tool: 'codex' });
  assert.equal(check.canStart, false, `expected codex to wait, got ${JSON.stringify(check)}`);
  assert.equal(check.oneAtATime, true);
  assert.equal(check.toolExternalProcessing, 4);
  assert.equal(check.untrackedProcesses, 4);

  // Claude is unaffected by codex containers.
  const claude = await queue.canStartCommand({ tool: 'claude' });
  assert.equal(claude.toolExternalProcessing, 0);
});

await test('findStartableItems holds a one-at-a-time head while its tool has an external task', async () => {
  const queue = createQueue();
  queue.checkSystemResources = async () => ({ ok: true, reasons: [], oneAtATime: true, rejected: false, rejectReason: null });
  queue.checkApiLimits = async () => ({ ok: true, reasons: [], oneAtATime: false, rejected: false, rejectReason: null });
  queue.enqueue({ url: 'https://github.com/link-assistant/router/issues/729', args: ['--tool', 'codex'], requester: 'u', tool: 'codex' });
  queue.enqueue({ url: 'https://github.com/link-assistant/router/issues/730', args: [], requester: 'u', tool: 'agent' });
  const startable = await queue.findStartableItems();
  assert.deepEqual(
    startable.map(s => s.tool),
    ['agent']
  );
  queue.stop?.();
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
