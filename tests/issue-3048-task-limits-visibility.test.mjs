/**
 * @hive-mind-test-suite default
 * Docker task CPU limits are visible (#3048): the queue's `Starting:` log names
 * the limits a task starts with, and the bot warns at startup when Docker
 * tasks run without a CPU limit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { configureQueueTaskLimits, describeQueueTaskLimits, formatQueueTaskLimits } from '../src/queue-task-limits.lib.mjs';
import { initializeTelegramContainerResourceLimits, resolveTelegramContainerResourceLimits } from '../src/telegram-container-resource-limits.lib.mjs';
import { SolveQueue } from '../src/telegram-solve-queue.lib.mjs';

const GiB = 1024 ** 3;
const capacity = { cpuCores: 6, memoryBytes: 12 * GiB, diskBytes: 100 * GiB };

test('Docker tasks get a 50% CPU cap by default and `unlimited` opts out', () => {
  assert.equal(resolveTelegramContainerResourceLimits({}, 'docker').limits.cpu, '50%');
  assert.equal(resolveTelegramContainerResourceLimits({ containerCpu: '2' }, 'docker').limits.cpu, '2');
  assert.equal(resolveTelegramContainerResourceLimits({ containerCpu: 'unlimited' }, 'docker').limits.cpu, null);
  assert.equal(resolveTelegramContainerResourceLimits({}, 'screen').limits.cpu, null);
});

function startup(config, backend) {
  const logs = [];
  const warnings = [];
  initializeTelegramContainerResourceLimits(config, backend, { log: m => logs.push(m), warn: m => warnings.push(m), logError: m => warnings.push(m), exit: () => {} });
  return { logs, warnings };
}

test('startup warns when Docker tasks have no CPU limit', () => {
  assert.deepEqual(startup({}, 'docker').warnings, []);
  const { warnings } = startup({ containerCpu: 'unlimited' }, 'docker');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /without a CPU limit/);
  assert.deepEqual(startup({}, 'screen').warnings, [], 'only Docker tasks can have a CPU limit');
});

test('the limits text resolves percentages on this host', () => {
  assert.equal(formatQueueTaskLimits({ cpu: '50%', memory: '60%', memoryReservation: '25%', disk: null }, capacity), 'CPU=50% (3 CPUs), RAM=60% (7.2 GiB), reservation=25% (3.0 GiB), disk=unlimited');
  assert.equal(formatQueueTaskLimits({ cpu: null, memory: '2GiB', disk: null }, capacity), 'CPU=unlimited, RAM=2GiB, disk=unlimited');
});

test('the Starting suffix follows the effective isolation backend', () => {
  configureQueueTaskLimits(null);
  assert.equal(describeQueueTaskLimits({}), '', 'nothing is added until the bot registers its settings');
  configureQueueTaskLimits({ isolationBackend: 'docker', containerResourceLimits: { cpu: '50%', memory: '60%', memoryReservation: '25%', disk: null }, capacity });
  assert.match(describeQueueTaskLimits({}), /\[limits: CPU=50% \(3 CPUs\), RAM=60%/);
  assert.equal(describeQueueTaskLimits({ perCommandIsolation: 'screen' }), ' [limits: none (screen isolation)]');
  configureQueueTaskLimits({ isolationBackend: '', containerResourceLimits: null });
  assert.equal(describeQueueTaskLimits({}), ' [limits: none (no isolation)]');
  configureQueueTaskLimits(null);
});

test('the queue logs the limits at Starting:', async () => {
  configureQueueTaskLimits({ isolationBackend: 'docker', containerResourceLimits: { cpu: '50%', memory: '60%', memoryReservation: '25%', disk: null }, capacity });
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  let executed;
  let timer;
  const done = new Promise(resolve => (executed = resolve));
  const queue = new SolveQueue({
    verbose: true,
    getRunningProcesses: async () => ({ count: 0, processes: [] }),
    getRunningIsolatedSessions: async () => ({ count: 0, byTool: {} }),
    getRunningSessionItems: async () => [],
    executeCallback: async () => {
      executed();
      return { success: true, output: 'session: s1' };
    },
  });
  queue.checkSystemResources = async () => ({ ok: true, reasons: [], oneAtATime: false, rejected: false, rejectReason: null });
  queue.checkApiLimits = async () => ({ ok: true, reasons: [], oneAtATime: false, rejected: false, rejectReason: null });
  try {
    queue.enqueue({ url: 'https://github.com/o/r/issues/1', args: [], tool: 'agent', requester: 'tester', infoBlock: '' });
    await Promise.race([done, new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('the queue did not start the item')), 15000)))]);
  } finally {
    clearTimeout(timer);
    queue.stop();
    console.log = original;
    configureQueueTaskLimits(null);
  }
  const starting = lines.find(line => line.includes('Starting:'));
  assert.ok(starting, lines.join('\n'));
  assert.match(starting, /\[limits: CPU=50% \(3 CPUs\), RAM=60% \(7\.2 GiB\), reservation=25% \(3\.0 GiB\), disk=unlimited\]/);
});
