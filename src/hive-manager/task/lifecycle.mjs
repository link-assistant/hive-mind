import { memoryAvailable, verifyMemory } from '../auto-fix/lib/resources.mjs';
import { digestPattern } from '../auto-fix/lib/policy.mjs';
import { executionId, localDockerEndpoint } from '../storage/lib/docker.mjs';
import { reviewedRepairCandidates } from './lib/record-repair.mjs';
import { readExecutionStore } from './lib/read-execution-store.mjs';
import { docker } from './lib/snapshot-space.mjs';
import { observedWatchers } from './lib/watchers.mjs';
import { applyProfileRecovery, previewProfileRecovery } from './recover-failed.mjs';
import { applyTaskRecordRepair } from './repair-records.mjs';

async function requireLocalTaskDaemon() {
  const endpoint = process.env.DOCKER_HOST || (await docker(['context', 'inspect', '--format', '{{(index .Endpoints "docker").Host}}']));
  if (localDockerEndpoint(endpoint.startsWith('unix://') ? endpoint.slice(7) : undefined) !== endpoint || (process.env.DOCKER_CONTEXT && process.env.DOCKER_CONTEXT !== 'default')) {
    throw new Error('Task lifecycle requires a local Docker Unix socket.');
  }
}

async function taskInventory(watchers, records, daemon) {
  let containers = [];
  if (daemon) {
    const listing = await docker(['ps', '-a', '--no-trunc', '--format', '{{.ID}}\t{{.Names}}\t{{.State}}\t{{.Label "start-command.uuid"}}']);
    containers = listing
      .split('\n')
      .filter(Boolean)
      .map(line => line.split('\t'));
  }
  const byUuid = new Map();
  const byId = new Map();
  for (const row of containers) {
    const [id, , , uuid] = row;
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Unexpected Docker task inventory.');
    byId.set(id, row);
    if (executionId.test(uuid ?? '')) {
      const associated = byUuid.get(uuid) ?? [];
      associated.push(row);
      byUuid.set(uuid, associated);
    }
  }
  const counts = { running: 0, paused: 0, finished: 0, other: 0 };
  const protectedTasks = [];
  const matched = new Set();
  for (const task of records) {
    if (!executionId.test(task?.uuid ?? '')) throw new Error('Invalid execution ID in the task store.');
    const row = byId.get(task.options?.containerId);
    const matches = [...new Set([...(byUuid.get(task.uuid) ?? []), ...(row && (!row[3] || row[3] === task.uuid) ? [row] : [])])];
    for (const [id] of matches) matched.add(id);
    const state = task.paused || matches.some(row => row[2] === 'paused') ? 'paused' : task.status === 'executing' || matches.some(row => ['running', 'restarting'].includes(row[2])) ? 'running' : ['executed', 'failed'].includes(task.status) ? 'finished' : 'other';
    counts[state]++;
    if (!['running', 'paused'].includes(state)) continue;
    const names = matches.filter(row => ['running', 'restarting', 'paused'].includes(row[2])).map(row => row[1]);
    if (!names.length && task.options?.isolated === 'docker' && task.options.sessionName) names.push(task.options.sessionName);
    protectedTasks.push({
      id: task.uuid,
      state,
      containers: names,
      watcher: names.some(name => watchers.has(name)) ? 'observed' : task.attempt?.watcherAttachedAt ? 'recorded-only' : 'unobserved',
    });
  }
  const unrecorded = containers.filter(([id, , state, uuid]) => !matched.has(id) && executionId.test(uuid ?? '') && ['running', 'restarting', 'paused'].includes(state));
  return {
    counts,
    protectedTasks: protectedTasks.slice(0, 250),
    omitted: Math.max(0, protectedTasks.length - 250),
    unrecordedCount: unrecorded.length,
    unrecordedContainers: unrecorded.slice(0, 250).map(([id, name, state, uuid]) => ({ id: `sha256:${id}`, name, state, uuid, watcher: watchers.has(name) || watchers.has(id) ? 'observed' : 'unobserved' })),
    docker: daemon,
  };
}

async function preview(policy) {
  const records = await readExecutionStore({ allowMissing: true });
  const needsDaemon = policy.variant === 'dind' || policy.repairRecords.length > 0 || policy.recovery || records.some(task => task?.options?.isolated === 'docker');
  if (needsDaemon) await requireLocalTaskDaemon();
  const watchers = await observedWatchers();
  const inventory = await taskInventory(watchers, records, Boolean(needsDaemon));
  const availableMemoryMiB = memoryAvailable();
  const repairs = [];
  if (policy.inventoryOnly || availableMemoryMiB < policy.minMemoryMiB) return { inventory, repairs, recovery: [], availableMemoryMiB };
  if (policy.repairRecords.length) {
    const candidates = await reviewedRepairCandidates(policy.repairRecords, process.env.START_APP_FOLDER, true);
    for (const uuid of policy.repairRecords) {
      const matches = candidates.get(uuid) ?? [];
      const target = matches.length === 1 ? matches[0] : null;
      repairs.push({ uuid, target: target && { ...target, id: `sha256:${target.id}` }, state: target ? (watchers.has(target.name) || watchers.has(target.id) ? 'watcher-present' : 'eligible') : matches.length ? 'ambiguous' : 'ineligible' });
    }
  }
  const recovery = policy.recovery ? await previewProfileRecovery({ ...policy.recovery, profile: true }) : [];
  return { inventory, repairs, recovery, availableMemoryMiB };
}

try {
  const [action, payload] = process.argv.slice(2);
  const { policy, candidate } = JSON.parse(payload);
  let result;
  if (action === 'preview') result = await preview(policy);
  else {
    await requireLocalTaskDaemon();
    verifyMemory(policy.minMemoryMiB);
    if (action === 'repair' && executionId.test(candidate?.uuid ?? '')) {
      const { target } = candidate;
      const id = target.id.slice(7);
      const outcomes = await applyTaskRecordRepair([candidate.uuid], {
        expected: { ...target, id },
        hasWatcher: async name => {
          const watchers = await observedWatchers();
          return watchers.has(name) || watchers.has(id);
        },
      });
      result = outcomes[0] ?? { uuid: candidate.uuid, state: 'changed' };
    } else if (action === 'recover' && executionId.test(candidate?.id ?? '') && digestPattern.test(candidate.approval ?? '')) {
      result = await applyProfileRecovery({ ...policy.recovery, profile: true }, candidate);
    } else throw new Error('Invalid task lifecycle action.');
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`hive-manager: ${error.message}\n`);
  process.exitCode = 1;
}
