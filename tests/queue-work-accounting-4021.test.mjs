/**
 * @hive-mind-test-suite default,pr-essential
 * Offline regressions for #4021: idle vendor services must not block dispatch.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { classifyToolProcesses, mergeToolWork, readToolProcessSnapshot } from '../src/queue-work.lib.mjs';
import { getRunningProcesses } from '../src/telegram-solve-queue.helpers.lib.mjs';
import { SolveQueue, QUEUE_CONFIG } from '../src/telegram-solve-queue.lib.mjs';
import { getLimitCache, resetLimitCache } from '../src/limits.lib.mjs';
import { createSessionRegistryQueries } from '../src/session-monitor.queries.lib.mjs';

const record = (pid, ppid, argv, extra = {}) => ({ pid, ppid, argv, state: 'S', ...extra });
const services = [record(10, 1, ['codex', 'app-server', 'daemon', 'pid-update-loop']), record(11, 10, ['codex', 'app-server', '--listen', 'unix://', '--analytics-default-enabled', '--managed-daemon']), record(12, 1, ['claude', '--chrome-native-host']), record(13, 1, ['claude', '--claude-in-chrome-mcp'])];
const url = 'https://github.com/test/repo/issues/1';
const ok = { ok: true, reasons: [], oneAtATime: false, rejected: false };

function cacheUsage(percentage) {
  resetLimitCache();
  const cache = getLimitCache();
  const usage = { currentSession: { percentage: 10 }, allModels: { percentage } };
  cache.set('codex', { success: true, usage });
  cache.set('claude', { success: true, usage });
  cache.set('github', { success: true, githubRateLimit: { usedPercentage: 10 } });
}

function queueFor({ records = services, sessions = [] } = {}) {
  const queue = new SolveQueue({ autoStart: false, getToolProcessSnapshot: async () => classifyToolProcesses(records), getRunningSessionItems: async () => sessions });
  queue.checkSystemResources = async () => ok;
  return queue;
}

test('managed services and Claude browser helpers are not work', { timeout: 10000 }, () => {
  assert.deepEqual(classifyToolProcesses(services), []);
});

test('each supported tool excludes server/auth/update/help modes and counts foreground jobs', { timeout: 10000 }, () => {
  for (const tool of ['claude', 'codex', 'agent', 'qwen', 'gemini']) {
    for (const args of [['serve'], ['login'], ['update'], ['--version'], ['--help'], ['--config', 'model=x', 'mcp', 'list']]) {
      assert.equal(classifyToolProcesses([record(10, 1, [tool, ...args])]).length, 0, `${tool} ${args}`);
    }
    assert.equal(classifyToolProcesses([record(10, 1, [tool, '-p', 'app-server --help'])]).length, 1, `${tool} prompt is not a service command`);
    assert.equal(classifyToolProcesses([record(10, 1, [tool])]).length, 1, `${tool} interactive CLI`);
  }
});

test('foreground wrapper/native trees count once, independent siblings count separately', { timeout: 10000 }, () => {
  const records = [record(20, 1, ['node', '--max-old-space-size=256', '/opt/node_modules/@openai/codex/bin/codex.js', 'exec', 'work']), record(21, 20, ['/opt/vendor/codex', 'exec', 'work']), record(22, 1, ['codex', 'exec', 'other work'])];
  const jobs = classifyToolProcesses(records);
  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs[0].pids, [20, 21]);
  assert.equal(jobs[1].pid, 22);
});

test('native version paths and Node CLI entrypoints work without matching prompt mentions', { timeout: 10000 }, () => {
  const jobs = classifyToolProcesses([record(20, 1, ['/home/box/.local/share/claude/versions/2.1.269', '-p', 'work'], { commandName: 'claude' }), record(30, 1, ['node', '/opt/node_modules/@anthropic-ai/claude-code/cli.js', '-p', 'work']), record(40, 1, ['node', '/opt/node_modules/@google/gemini-cli/dist/index.js', '-p', 'work']), record(50, 1, ['node', '/opt/node_modules/@qwen-code/qwen-code/cli.js', '-p', 'work']), record(60, 1, ['node', '/opt/node_modules/@link-assistant/agent/bin/cli.js', 'run']), record(70, 1, ['node', 'unrelated.js', 'codex', 'exec']), record(80, 1, ['bash', '-c', 'codex exec work'])]);
  assert.deepEqual(
    jobs.map(job => job.tool),
    ['claude', 'claude', 'gemini', 'qwen', 'agent']
  );
});

test('zombies and exited processes are excluded; ancestry cycles are bounded', { timeout: 10000 }, () => {
  const jobs = classifyToolProcesses([record(10, 1, ['codex', 'exec'], { state: 'Z' }), record(11, 1, ['claude'], { state: 'X' }), record(20, 21, ['codex', 'exec']), record(21, 20, ['sh'])]);
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0].ancestorPids, [20, 21]);
});

test('the process reader classifies NUL-separated argv and tolerates vanished PIDs', { timeout: 10000 }, async () => {
  const procRoot = await mkdtemp(join(tmpdir(), 'queue-work-4021-'));
  try {
    for (const proc of [...services, record(20, 1, ['codex', 'exec', 'work'])]) {
      const dir = join(procRoot, String(proc.pid));
      await mkdir(dir);
      await writeFile(join(dir, 'stat'), `${proc.pid} (${proc.argv[0]}) ${proc.state} ${proc.ppid} 0 0`);
      await writeFile(join(dir, 'cmdline'), `${proc.argv.join('\0')}\0`);
      await writeFile(join(dir, 'environ'), 'STY=100.task-one\0PRIVATE=value-never-logged\0');
    }
    await mkdir(join(procRoot, '999'));
    const result = await getRunningProcesses('codex', false, { procRoot });
    assert.equal(result.count, 1);
    assert.deepEqual(result.processes, ['20:codex']);
    assert.equal(result.jobs[0].screenSessionName, 'task-one');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|never-logged|app-server|work"/);
    assert.deepEqual(await readToolProcessSnapshot(false, { procRoot: join(procRoot, 'missing') }), []);
  } finally {
    await rm(procRoot, { recursive: true, force: true });
  }
});

for (const tool of ['claude', 'codex']) {
  for (const percentage of [50, 98]) {
    test(`${tool} services-only at ${percentage}% permits admission and displays zero work`, { timeout: 10000 }, async () => {
      cacheUsage(percentage);
      const queue = queueFor();
      const result = await queue.canStartCommand({ tool });
      assert.equal(result.canStart, true);
      assert.equal(result.oneAtATime, percentage === 98);
      assert.equal(result.totalProcessing, 0);
      assert.match(await queue.formatStatus(), new RegExp(`${tool} \\(pending: 0, processing: 0\\)`));
      assert.match(await queue.formatDetailedStatus(), /Processing: 0/);
    });
  }
  test(`${tool} real work blocks at 98% and permits parallel work at 50%`, { timeout: 10000 }, async () => {
    const queue = queueFor({ records: [...services, record(20, 1, [tool, '-p', 'work'])] });
    cacheUsage(98);
    const blocked = await queue.canStartCommand({ tool });
    assert.equal(blocked.canStart, false);
    assert.equal(blocked.totalProcessing, 1);
    assert.match(blocked.reason, /waiting for current command/);
    assert.match(await queue.formatStatus(), new RegExp(`${tool} \\(pending: 0, processing: 1\\)`));
    assert.match(await queue.formatDetailedStatus(), /Processing: 1/);
    cacheUsage(50);
    assert.equal((await queue.canStartCommand({ tool })).canStart, true);
  });
}

test('active app-server-backed turns count from executions, regardless of daemon trees', { timeout: 10000 }, async () => {
  cacheUsage(98);
  const sessions = [
    { sessionName: 'turn-1', tool: 'codex', url, isolationBackend: 'screen', status: 'executing' },
    { sessionName: 'turn-2', tool: 'codex', url: `${url}0`, isolationBackend: 'docker', status: 'executing' },
  ];
  const queue = queueFor({ sessions });
  const result = await queue.canStartCommand({ tool: 'codex' });
  assert.equal(result.canStart, false);
  assert.equal(result.codexProcesses, 2);
  assert.equal(result.totalProcessing, 2);
  assert.match(await queue.formatDetailedStatus(), /Processing: 2/);
});

test('one snapshot deduplicates tracked screen work, queue launch and native wrapper pairs', { timeout: 10000 }, async () => {
  cacheUsage(98);
  const records = [record(10, 1, ['node', 'solve.mjs', url]), record(20, 10, ['node', '/opt/codex/bin/codex.js', 'exec']), record(21, 20, ['codex', 'exec'])];
  const sessions = [{ sessionName: 'screen-one', tool: 'codex', url, status: 'executing', isolationBackend: 'screen', processIds: { wrapperPid: 10 } }];
  const queue = queueFor({ records, sessions });
  queue.processing.set('launch', { id: 'launch', tool: 'codex', url });
  let resourceCount;
  queue.checkSystemResources = async count => {
    resourceCount = count;
    return ok;
  };
  const result = await queue.canStartCommand({ tool: 'codex' });
  assert.equal(resourceCount, 1);
  assert.equal(result.codexProcessingCount, 1);
  assert.equal(result.totalProcessing, 1);
  assert.match(await queue.formatStatus(), /codex \(pending: 0, processing: 1\)/);
  assert.match(await queue.formatDetailedStatus(), /Processing: 1/);
  const beforeTracking = mergeToolWork({ jobs: classifyToolProcesses(records), processingItems: queue.processing.values() });
  assert.equal(beforeTracking.total, 1, 'launcher URL joins work before tracking');
});

test('STY joins detached work; Docker PIDs do not collide with host PIDs', { timeout: 10000 }, () => {
  const jobs = classifyToolProcesses([record(20, 1, ['claude', '-p', 'work'], { screenSessionName: '100.screen-one' })]);
  const screen = { sessionName: 'screen-one', tool: 'claude', url, isolationBackend: 'screen' };
  assert.equal(mergeToolWork({ jobs, sessionItems: [screen, { ...screen }] }).total, 1);
  const docker = { ...screen, isolationBackend: 'docker', processIds: { childPid: 20 } };
  assert.equal(mergeToolWork({ jobs, sessionItems: [docker] }).total, 2);
});

test('distinct local and Docker jobs are added across tools for resource throttling', { timeout: 10000 }, async () => {
  cacheUsage(50);
  const queue = queueFor({
    records: [...services, record(20, 1, ['codex', 'exec']), record(30, 1, ['claude', '-p', 'work'])],
    sessions: [
      { sessionName: 'docker-one', tool: 'codex', url, status: 'executing', isolationBackend: 'docker' },
      { sessionName: 'screen-one', tool: 'agent', url: `${url}0`, status: 'executing', isolationBackend: 'screen' },
    ],
  });
  const cache = getLimitCache();
  cache.set('memory', { success: true, memory: { usedPercentage: 98 } });
  cache.set('cpu', { success: true, cpuLoad: { loadAvg5: 0, cpuCount: 1 } });
  cache.set('disk', { success: true, diskSpace: { freePercentage: 90 } });
  const original = { ...QUEUE_CONFIG.thresholds.ram };
  Object.assign(QUEUE_CONFIG.thresholds.ram, { value: 0.97, strategy: 'dequeue-one-at-a-time' });
  try {
    delete queue.checkSystemResources;
    const result = await queue.canStartCommand({ tool: 'qwen' });
    assert.equal(result.totalProcessing, 4);
    assert.equal(result.codexProcesses, 2);
    assert.equal(result.canStart, false);
    assert.match(result.reason, /RAM/);
    assert.equal((await queue.getExternalProcessingSnapshot()).total, 4);
  } finally {
    Object.assign(QUEUE_CONFIG.thresholds.ram, original);
  }
});

test('registry liveness excludes stale records and exposes identities for live detached executions', { timeout: 10000 }, async () => {
  const activeSessions = new Map([
    ['done', { tool: 'codex', isolationBackend: 'screen' }],
    ['stale', { tool: 'claude', isolationBackend: 'docker' }],
    ['live', { tool: 'codex', isolationBackend: 'docker', sessionId: 'uuid-live', url }],
  ]);
  const queries = createSessionRegistryQueries({ activeSessions, getIsolationSessionState: async name => ({ running: name === 'live', status: name === 'live' ? 'executing' : 'executed', statusResult: { processIds: { wrapperPid: 42 } } }) });
  const items = await queries.getRunningSessionItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].sessionId, 'uuid-live');
  assert.deepEqual(items[0].processIds, { wrapperPid: 42 });
  cacheUsage(98);
  const queue = queueFor({ sessions: items });
  assert.equal((await queue.canStartCommand({ tool: 'codex' })).canStart, false);
  activeSessions.clear();
  assert.equal((await queueFor({ sessions: await queries.getRunningSessionItems() }).canStartCommand({ tool: 'codex' })).canStart, true);
});

test('concurrent admissions with services only reserve exactly one startup slot', { timeout: 10000 }, async () => {
  cacheUsage(98);
  const queue = queueFor();
  const results = await Promise.all([queue.reserveStartSlot({ tool: 'codex' }), queue.reserveStartSlot({ tool: 'codex' })]);
  assert.equal(results.filter(result => result.startReserved).length, 1);
  assert.equal(results.filter(result => !result.canStart).length, 1);
  assert.equal((await queue.canStartCommand({ tool: 'codex' })).canStart, false);
});

test('one-at-a-time admission remains atomic with startup pacing disabled; reservations release on failed launch', { timeout: 10000 }, async () => {
  cacheUsage(98);
  const previousInterval = QUEUE_CONFIG.MIN_START_INTERVAL_MS;
  QUEUE_CONFIG.MIN_START_INTERVAL_MS = 0;
  try {
    const queue = queueFor();
    const results = await Promise.all([queue.reserveStartSlot({ tool: 'codex', url }), queue.reserveStartSlot({ tool: 'codex', url: `${url}0` })]);
    assert.equal(results.filter(result => result.startReserved).length, 1);
    assert.match(await queue.formatStatus(), /codex \(pending: 0, processing: 1\)/);
    assert.match(await queue.formatDetailedStatus(), /Processing: 1/);
    assert.match(await queue.formatDetailedStatus(), /test\/repo#1/);
    const admitted = results.find(result => result.startReserved);
    admitted.releaseStartReservation();
    assert.equal((await queue.canStartCommand({ tool: 'codex' })).canStart, true);
    assert.equal(queue.startReservations.size, 0);
  } finally {
    QUEUE_CONFIG.MIN_START_INTERVAL_MS = previousInterval;
  }
});

test('queue consumer and direct admission share the reservation with startup pacing disabled', { timeout: 10000 }, async () => {
  cacheUsage(98);
  const previousInterval = QUEUE_CONFIG.MIN_START_INTERVAL_MS;
  QUEUE_CONFIG.MIN_START_INTERVAL_MS = 0;
  try {
    const queue = queueFor();
    queue.enqueue({ url, tool: 'codex' });
    let executions = 0;
    queue.executeItem = async () => {
      executions++;
      queue.stop();
    };
    queue.sleep = async () => queue.stop();
    const [direct] = await Promise.all([queue.reserveStartSlot({ tool: 'codex', url: `${url}0` }), queue.runConsumer()]);
    assert.equal(Number(direct.startReserved) + executions, 1);
    direct.releaseStartReservation?.();
  } finally {
    QUEUE_CONFIG.MIN_START_INTERVAL_MS = previousInterval;
  }
});

test('detailed status preserves separate execution identities even when URLs match or are absent', { timeout: 10000 }, async () => {
  const queue = queueFor({
    sessions: [
      { sessionName: 'one', tool: 'codex', url },
      { sessionName: 'two', tool: 'codex', url },
      { sessionName: 'three', tool: 'codex' },
    ],
  });
  assert.equal((await queue.getExternalProcessingSnapshot()).total, 3);
  assert.match(await queue.formatStatus(), /codex \(pending: 0, processing: 3\)/);
  assert.match(await queue.formatDetailedStatus(), /Processing: 3/);
});
