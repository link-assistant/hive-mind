import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { parse as parseToml } from 'smol-toml';

const run = promisify(execFile);
// Match start-command's snapshot preflight: room for two copies plus 10 GiB.
const reserveBytes = 10 * 1024 ** 3;
const inspectFormat = '{"id":{{json .Id}},"name":{{json .Name}},"state":{{json .State.Status}},"exitCode":{{json .State.ExitCode}},"size":{{json .SizeRw}},"labels":{{json .Config.Labels}}}';

export async function docker(args) {
  const { stdout } = await run('docker', args, { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trimEnd();
}

async function storageRoots() {
  const endpoint = !process.env.DOCKER_CONTEXT && process.env.DOCKER_HOST ? process.env.DOCKER_HOST : await docker(['context', 'inspect', '--format', '{{(index .Endpoints "docker").Host}}']);
  if (!endpoint.startsWith('unix:///')) throw new Error('Check snapshot space on the Docker daemon host.');
  const info = JSON.parse(await docker(['info', '--format', '{{json .}}']));
  const roots = [info.DockerRootDir];
  if (JSON.stringify(info.DriverStatus ?? []).includes('io.containerd.snapshotter')) {
    const config = process.env.START_CONTAINERD_ROOT
      ? {}
      : await readFile('/etc/containerd/config.toml', 'utf8').then(parseToml, error => {
          if (error.code !== 'ENOENT') throw error;
          return {};
        });
    roots.push(process.env.START_CONTAINERD_ROOT || config.root || '/var/lib/containerd');
  }
  if (roots.some(root => typeof root !== 'string' || !isAbsolute(root))) throw new Error('Unknown Docker storage root.');
  return [...new Set(roots)];
}

async function freeBytes(root) {
  const { stdout } = await run('df', ['-Pk', root], { timeout: 5000, maxBuffer: 4096, env: { ...process.env, LC_ALL: 'C' } });
  const blocks = stdout.trimEnd().split('\n').at(-1).trim().split(/\s+/)[3];
  const available = Number(blocks) * 1024;
  if (!/^\d+$/.test(blocks ?? '') || !Number.isSafeInteger(available)) throw new Error('Unknown free space.');
  return available;
}

export async function snapshotSpace({ id, family, container, containerId, exitCode, requireIdentity = false }) {
  let layer;
  try {
    layer = JSON.parse(await docker(['container', 'inspect', '--size', '--format', inspectFormat, '--', container]));
  } catch {
    return { state: 'container-unavailable' };
  }
  const { size, labels } = layer;
  const labeledId = labels?.['start-command.uuid'];
  const labeledFamily = labels?.['start-command.root-session'];
  if (layer.name !== `/${container}` || layer.state !== 'exited' || layer.exitCode !== exitCode || !/^[a-f\d]{64}$/.test(layer.id) || (containerId && !layer.id.startsWith(containerId)) || (labeledId && labeledId !== id) || (labeledFamily && labeledFamily !== family)) {
    return { state: 'container-changed' };
  }
  if (requireIdentity && labeledId !== id && containerId !== layer.id) return { state: 'container-unattributed' };
  const requiredBytes = 2 * size + reserveBytes;
  if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(requiredBytes)) return { state: 'writable-layer-unknown' };
  const estimate = { ...(requireIdentity ? { containerId: `sha256:${layer.id}` } : {}), writableLayerBytes: size, requiredBytes };
  try {
    const roots = await storageRoots();
    const availableBytes = Math.min(...(await Promise.all(roots.map(freeBytes))));
    return { ...estimate, availableBytes, state: availableBytes >= requiredBytes ? 'ready' : 'insufficient-space' };
  } catch {
    return { ...estimate, state: 'free-space-unknown' };
  }
}
