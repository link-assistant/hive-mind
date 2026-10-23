/**
 * @hive-mind-test-suite default
 * Fair CPU gate (#3048): the CPU a capped Docker task already uses is reserved
 * for it, so a task busy at its own --cpus limit does not hold the queue's CPU
 * gate closed for every other tool. Uncapped load still blocks as before.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFairCpuUsage, getSessionCpuCap, summarizeCappedTaskCpu } from '../src/queue-fair-cpu-gate.lib.mjs';
import { resolveContainerResourceLimits } from '../src/container-resource-limits.lib.mjs';
import { DEFAULT_DOCKER_TASK_CPU } from '../src/telegram-container-resource-limits.lib.mjs';
import { SolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { getLimitCache, resetLimitCache } from '../src/limits.lib.mjs';

const NOW = 1_800_000_000_000;
const HOST_CPUS = 6;

function busySession(cores, { cpuCores = resolveContainerResourceLimits({ cpu: DEFAULT_DOCKER_TASK_CPU }, { cpuCores: HOST_CPUS }).cpuCores, penalty = {}, extra = {} } = {}) {
  const samples = Array.from({ length: 10 }, (_, i) => ({ at: NOW - i * 30_000, cores })).reverse();
  return { isolationBackend: 'docker', sessionId: 'task', tool: 'claude', containerResourceLimits: { cpuCores }, cpuPenalty: { phase: 'observing', samples, limitCpus: null, ...penalty }, ...extra };
}

test('the default CPU cap is half the host', () => {
  assert.equal(DEFAULT_DOCKER_TASK_CPU, '50%');
  assert.equal(resolveContainerResourceLimits({ cpu: DEFAULT_DOCKER_TASK_CPU }, { cpuCores: HOST_CPUS }).cpuCores, 3);
});

test('a session cap is its penalty cap while penalized, otherwise its --cpus limit', () => {
  assert.equal(getSessionCpuCap(busySession(3), HOST_CPUS), 3);
  assert.equal(getSessionCpuCap(busySession(2, { penalty: { phase: 'penalized', limitCpus: 2 } }), HOST_CPUS), 2);
  assert.equal(getSessionCpuCap(busySession(6, { cpuCores: null }), HOST_CPUS), null, 'an uncapped task reserves nothing');
  assert.equal(getSessionCpuCap(busySession(6, { cpuCores: 12 }), HOST_CPUS), HOST_CPUS, 'a cap above the host is the host');
});

test('only running, freshly sampled Docker sessions count', () => {
  const stale = busySession(3);
  stale.cpuPenalty.samples = stale.cpuPenalty.samples.map(s => ({ ...s, at: s.at - 10 * 60_000 }));
  const entries = [
    { sessionName: 'busy', sessionInfo: busySession(3) },
    { sessionName: 'done', sessionInfo: busySession(3, { extra: { completionNotifiedAt: NOW - 1000 } }) },
    { sessionName: 'stale', sessionInfo: stale },
    { sessionName: 'screen', sessionInfo: busySession(3, { extra: { isolationBackend: 'screen' } }) },
    { sessionName: 'no-samples', sessionInfo: { isolationBackend: 'docker', sessionId: 'x', containerResourceLimits: { cpuCores: 3 } } },
  ];
  const summary = summarizeCappedTaskCpu(entries, { now: NOW, hostCpus: HOST_CPUS });
  assert.deepEqual(
    summary.tasks.map(t => t.sessionName),
    ['busy']
  );
  assert.equal(summary.reservedCores, 3);
  assert.equal(summary.cappedCpus, 3);
});

test('usage above the cap is bounded by the cap', () => {
  const summary = summarizeCappedTaskCpu([{ sessionName: 'a', sessionInfo: busySession(3.4) }], { now: NOW, hostCpus: HOST_CPUS });
  assert.equal(summary.reservedCores, 3);
});

test('the fair ratio leaves out the CPU a capped task already uses', () => {
  const tasks = [{ capCpus: 3, usageCores: 3 }];
  const fair = computeFairCpuUsage({ loadAvg5: 4.5, cpuCount: HOST_CPUS, tasks });
  assert.equal(fair.rawRatio, 0.75);
  assert.equal(fair.fairRatio, 0.5, '1.5 cores of other load on the 3 cores the task cannot use');
  assert.equal(fair.effectiveRatio, 0.5);
  assert.equal(computeFairCpuUsage({ loadAvg5: 4.5, cpuCount: HOST_CPUS, tasks: [] }).effectiveRatio, 0.75, 'no capped task: raw load decides');
  const full = computeFairCpuUsage({
    loadAvg5: 6,
    cpuCount: HOST_CPUS,
    tasks: [
      { capCpus: 3, usageCores: 3 },
      { capCpus: 3, usageCores: 3 },
    ],
  });
  assert.equal(full.effectiveRatio, 1, 'capped tasks that fill the host still block');
  const overloaded = computeFairCpuUsage({ loadAvg5: 9, cpuCount: HOST_CPUS, tasks });
  assert.ok(overloaded.effectiveRatio >= 1, 'an overloaded host is never reported as free');
});

function primeCache({ loadAvg5, cpuCount }) {
  resetLimitCache();
  const cache = getLimitCache();
  cache.set('memory', { success: true, memory: { usedPercentage: 30 } });
  cache.set('disk', { success: true, diskSpace: { freePercentage: 70 } });
  cache.set('cpu', { success: true, cpuLoad: { loadAvg5, cpuCount } });
}

function createQueue(sessions) {
  const queue = new SolveQueue({ verbose: false, autoStart: false, getRunningProcesses: async tool => ({ count: tool === 'claude' ? 1 : 0, processes: [] }), getRunningIsolatedSessions: async () => ({ count: 1, byTool: { claude: 1 } }), getRunningSessionItems: async () => [] });
  queue.getCappedTaskCpuFn = async () => summarizeCappedTaskCpu(sessions, { now: NOW, hostCpus: HOST_CPUS });
  return queue;
}

test('a task using 100% of its default CPU cap does not block another tool queue', async () => {
  // A claude task pinned at its 3-core default cap; host load also has 1.5 cores of other work.
  primeCache({ loadAvg5: 4.5, cpuCount: HOST_CPUS });
  const queue = createQueue([{ sessionName: 'claude-task', sessionInfo: busySession(3) }]);
  for (const tool of ['codex', 'agent']) {
    const check = await queue.canStartCommand({ tool });
    assert.ok(!check.reasons.some(reason => /CPU/i.test(reason)), `${tool}: ${check.reasons.join('; ')}`);
  }
  // Control: without the fair gate the same 75% host load closes the 65% CPU gate.
  queue.getCappedTaskCpuFn = async () => ({ tasks: [], reservedCores: 0, cappedCpus: 0 });
  assert.ok((await queue.canStartCommand({ tool: 'codex' })).reasons.some(reason => /CPU/i.test(reason)));
  resetLimitCache();
});

test('an uncapped task at 100% host CPU still blocks the queue', async () => {
  primeCache({ loadAvg5: 6.44, cpuCount: HOST_CPUS });
  const queue = createQueue([{ sessionName: 'claude-task', sessionInfo: busySession(5.4, { cpuCores: null }) }]);
  const check = await queue.canStartCommand({ tool: 'codex' });
  assert.ok(check.reasons.some(reason => /CPU/i.test(reason)));
  resetLimitCache();
});
