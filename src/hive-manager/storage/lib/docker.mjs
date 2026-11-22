import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';
import { snapshotUpper } from './containerd.mjs';
import { output } from './process.mjs';

export const containerId = /^[a-f0-9]{64}$/;
export const executionId = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
export const runtimeRoots = ['/var/lib/docker', '/var/lib/containerd', '/run/containerd', '/var/lib/containers'];
export const within = (path, parent) => path === parent || path.startsWith(parent === '/' ? '/' : `${parent}/`);
export const overlaps = (a, b) => within(a, b) || within(b, a);
export const absolute = path => typeof path === 'string' && isAbsolute(path) && normalize(path) === path && !/[\0\r\n]/.test(path);
const decodeMount = text => text.replace(/\\([0-7]{3})/g, (_, digits) => String.fromCharCode(parseInt(digits, 8)));

export function mountTable(pid = 'self') {
  return readFileSync(`/proc/${pid}/mountinfo`, 'utf8')
    .trimEnd()
    .split('\n')
    .map(line => {
      const [left, right] = line.split(' - ');
      const fields = left.split(' ');
      const [type, , options] = right.split(' ');
      return { path: decodeMount(fields[4]), type, options };
    });
}

export function localDocker(socket) {
  const endpoint = socket ? `unix://${socket}` : process.env.DOCKER_HOST || 'unix:///var/run/docker.sock';
  if ((!socket && process.env.DOCKER_CONTEXT && process.env.DOCKER_CONTEXT !== 'default') || !endpoint.startsWith('unix://') || !absolute(endpoint.slice(7))) {
    throw new Error('Use a local Docker Unix socket on the daemon host. Select it with --docker-socket.');
  }
  return (args, options) => output('docker', ['--host', endpoint, ...args], options);
}

const facts = {
  id: '.Id',
  name: '.Name',
  image: '.Image',
  state: '.State',
  driver: 'index . "Driver"',
  mounts: 'index . "Mounts"',
  tmpfs: 'index .HostConfig "Tmpfs"',
  logPath: 'index . "LogPath"',
  logDriver: 'index .HostConfig.LogConfig "Type"',
  command: 'index .Config "Cmd"',
};
const graph = '{{with index . "GraphDriver"}}{{json (index . "Data")}}{{else}}null{{end}}';
const labels = key => `{{with index .Config "Labels"}}{{json (index . "${key}")}}{{else}}null{{end}}`;
// Print only the two start-command environment values. Docker inspect may contain secrets.
const executionEnv = '[{{range index .Config "Env"}}{{if or (eq (printf "%.19s" .) "START_EXECUTION_ID=") (eq (printf "%.19s" .) "START_SESSION_NAME=")}}{{json .}},{{end}}{{end}}null]';
const inspectFormat = `{${Object.entries(facts)
  .map(([key, value]) => `"${key}":{{json (${value})}}`)
  .join(',')},"graph":${graph},"execution":${labels('start-command.uuid')},"session":${labels('start-command.session')},"executionEnv":${executionEnv}}`;

export async function inspect(docker, ids, options) {
  const text = await docker(['container', 'inspect', '--format', inspectFormat, '--', ...ids], options);
  return text.split('\n').map(line => {
    const row = JSON.parse(line);
    if (!containerId.test(row.id)) throw new Error('Unexpected Docker container identity.');
    for (const env of row.executionEnv.filter(Boolean)) {
      if (env.startsWith('START_EXECUTION_ID=')) row.execution ||= env.slice(19);
      if (env.startsWith('START_SESSION_NAME=')) row.session ||= env.slice(19);
    }
    delete row.executionEnv;
    row.name = row.name.replace(/^\//, '');
    return row;
  });
}

export async function dockerRoot(docker, options) {
  const path = await docker(['info', '--format', '{{.DockerRootDir}}'], options);
  if (!absolute(path) || path === '/') throw new Error('Docker did not return a usable data root.');
  return path;
}

export async function inventory(docker, options, { limit = 256, onError } = {}) {
  const currentOptions = typeof options === 'function' ? options : () => options;
  const text = await docker(['container', 'ls', '-aq', '--no-trunc'], currentOptions());
  const ids = text.split('\n').filter(Boolean);
  if (ids.some(id => !containerId.test(id))) throw new Error('Unexpected Docker container list.');
  if (ids.length > limit) {
    if (!onError) throw new Error('Docker inventory exceeds the cleanup limit.');
    onError(`Docker inventory limited to ${limit} of ${ids.length} containers`);
  }
  const rows = [];
  for (let offset = 0; offset < Math.min(ids.length, limit); offset += 16) {
    try {
      rows.push(...(await inspect(docker, ids.slice(offset, Math.min(offset + 16, limit)), currentOptions())));
    } catch (error) {
      if (!onError) throw error;
      onError(`Container inventory incomplete at offset ${offset}: ${error.message}`);
    }
  }
  return rows;
}

export async function upperDirectory(row, root, options) {
  let candidate = row.graph?.UpperDir;
  if (!candidate && Number.isSafeInteger(row.state.Pid) && row.state.Pid > 0) {
    try {
      const overlay = mountTable(row.state.Pid).find(mount => mount.path === '/' && ['overlay', 'fuse.overlayfs'].includes(mount.type));
      candidate = decodeMount(/(?:^|,)upperdir=([^,]+)/.exec(overlay?.options)?.[1] ?? '');
    } catch (error) {
      if (!['EACCES', 'EPERM', 'ENOENT'].includes(error.code)) throw error;
    }
  }
  if (!candidate && ['overlay2', 'overlayfs'].includes(row.driver)) {
    // With Docker's containerd image store the container ID is the active snapshot key.
    const sockets = ['/run/docker/containerd/containerd.sock', '/run/containerd/containerd.sock'];
    for (const socket of sockets) {
      const currentOptions = typeof options === 'function' ? options() : options;
      currentOptions?.check?.();
      try {
        if (!lstatSync(socket).isSocket()) continue;
        candidate = await snapshotUpper(socket, row.id, currentOptions);
        if (absolute(candidate)) break;
      } catch {
        currentOptions?.check?.();
      }
    }
  }
  if (!absolute(candidate)) throw new Error('Writable overlay path unavailable for this storage driver.');
  const real = realpathSync(candidate);
  const allowed = [root, '/var/lib/containerd', `${root}/containerd`].some(base => real !== base && within(real, base));
  if (!allowed || !lstatSync(real).isDirectory()) throw new Error('Writable overlay path could not be verified inside local runtime storage.');
  return real;
}

function targetUrl(command) {
  const text = Array.isArray(command) ? command.join(' ') : command;
  return typeof text === 'string' ? (/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/\d+\b/i.exec(text)?.[0] ?? null) : null;
}

export function correlate(rows, executions) {
  const byUuid = new Map();
  const byContainer = new Map();
  for (const task of executions) {
    if (!executionId.test(task?.uuid)) continue;
    byUuid.set(task.uuid.toLowerCase(), task);
    if (task.options?.isolated !== 'docker') continue;
    for (const id of [task.options?.containerId, ...(Array.isArray(task.attemptHistory) ? task.attemptHistory.map(attempt => attempt?.containerId) : [])]) {
      if (containerId.test(id)) byContainer.set(id, task);
    }
  }
  return rows.map(row => {
    const uuid = executionId.test(row.execution) ? row.execution.toLowerCase() : null;
    const task = uuid ? byUuid.get(uuid) : byContainer.get(row.id);
    return { execution: uuid ?? task?.uuid ?? null, session: row.session || task?.options?.sessionName || null, target: targetUrl(task?.command) ?? (uuid ? targetUrl(row.command) : null), recordMatched: Boolean(task) };
  });
}
