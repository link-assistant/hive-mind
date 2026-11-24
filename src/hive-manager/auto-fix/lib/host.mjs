import { readFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { absolute, containerId, localDocker } from '../../storage/lib/docker.mjs';
import { output, run } from '../../storage/lib/process.mjs';
import { memoryAvailable, storageAvailable } from './resources.mjs';

export const bootId = () => readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();

async function journal(args, matches = () => true) {
  const result = await run('journalctl', ['--since=-24h', '--lines=80', '--no-pager', '--output=cat', ...args], { maxBytes: 128 * 1024 });
  if (result.code !== 0) return null;
  return result.stdout.split('\n').filter(line => line.trim() && line !== '-- No entries --' && matches(line)).length;
}

export async function hostDiagnostics() {
  const [dockerServiceEntries, kernelOomEntries] = await Promise.all([journal(['--unit=docker.service']).catch(() => null), journal(['_TRANSPORT=kernel'], line => /out of memory|oom-kill|killed process/i.test(line)).catch(() => null)]);
  return {
    bootId: bootId(),
    uptimeSeconds: Math.floor(Number(readFileSync('/proc/uptime', 'utf8').split(' ')[0])),
    loadAverage: readFileSync('/proc/loadavg', 'utf8').split(' ').slice(0, 3).map(Number),
    dockerServiceEntries,
    kernelOomEntries,
  };
}

export function hostDocker(policy) {
  return localDocker(policy.endpoint.slice(7));
}

export async function daemonFacts(docker) {
  const text = await docker(['info', '--format', '{"id":{{json .ID}},"version":{{json .ServerVersion}},"root":{{json .DockerRootDir}},"liveRestore":{{json .LiveRestoreEnabled}}}']);
  const { id, version, root, liveRestore } = JSON.parse(text);
  if (typeof id !== 'string' || !id || typeof version !== 'string' || !absolute(root) || root === '/') throw new Error('Docker daemon identity or local storage is unavailable.');
  return { id, version, root, liveRestore };
}

export async function mayStartHostDocker(endpoint) {
  if (!['unix:///var/run/docker.sock', 'unix:///run/docker.sock'].includes(endpoint)) return false;
  try {
    const state = await output('systemctl', ['show', '--property=LoadState', '--property=ActiveState', 'docker.service']);
    return /^LoadState=loaded$/m.test(state) && /^ActiveState=(inactive|failed)$/m.test(state);
  } catch {
    return false;
  }
}

export async function instanceFacts(docker, name) {
  const text = await docker(['container', 'inspect', '--format', '{"id":{{json .Id}},"name":{{json .Name}},"status":{{json .State.Status}},"startedAt":{{json .State.StartedAt}},"pid":{{json .State.Pid}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"task":{{with .Config.Labels}}{{json (index . "start-command.uuid")}}{{else}}null{{end}}}', '--', name]);
  const { id, name: actual, status, startedAt, pid, health, task } = JSON.parse(text);
  if (!containerId.test(id) || actual !== `/${name}` || task || typeof startedAt !== 'string' || !Number.isInteger(pid)) throw new Error('Could not verify the selected deployment container.');
  return { id, status, startedAt, pid, health };
}

export const instanceReady = instance => instance.status === 'running' && instance.pid > 0 && (!instance.health || instance.health === 'healthy');

export function sameInstance(a, b) {
  return a.id === b.id && a.startedAt === b.startedAt && a.status === b.status && a.pid === b.pid;
}

function existingPath(path) {
  for (let current = path; ; current = dirname(current)) {
    try {
      return realpathSync(current);
    } catch (error) {
      if (error.code !== 'ENOENT' || current === '/') throw error;
    }
  }
}

export function preflight(policy, daemon, receiptRoot) {
  const paths = [...new Set(['/', existingPath(policy.stateDir), existingPath(receiptRoot), ...(daemon ? [realpathSync(daemon.root)] : [])])];
  const storage = paths.map(path => ({ path, ...storageAvailable(path) }));
  const availableMemoryMiB = memoryAvailable();
  const blockers = [];
  if (availableMemoryMiB < policy.minMemoryMiB) blockers.push(`Available memory is ${availableMemoryMiB} MiB. This policy requires ${policy.minMemoryMiB} MiB.`);
  for (const item of storage) {
    if (item.availableBytes < policy.minFreeGiB * 1024 ** 3) blockers.push(`${item.path} has less than ${policy.minFreeGiB} GiB available.`);
    if (item.freeInodes === 0) blockers.push(`${item.path} has no free inodes.`);
  }
  return { storage, availableMemoryMiB, blockers };
}

export async function instanceTasks(docker, instance, action, policy, candidate) {
  const seconds = action === 'recover' ? 210 : action === 'preview' ? 360 : 90;
  const result = await docker(['exec', '--user', 'box', instance.id, 'timeout', '--signal=KILL', String(seconds), 'hive-manager', 'tasks', 'lifecycle', action, JSON.stringify({ policy, candidate })], { ms: (seconds + 5) * 1000 });
  return JSON.parse(result);
}
