import { lstatSync, realpathSync, statfsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { absolute, correlate, dockerRoot, executionId, inventory, mountTable, runtimeRoots, upperDirectory, within } from './lib/docker.mjs';
import { output } from './lib/process.mjs';
import { taskRecords } from './lib/records.mjs';

const hostPaths = ['/var/log', '/var/cache', '/var/lib', '/home', '/root', '/tmp', '/opt', '/srv', '/workspace', '/usr'];

export async function diskReport(docker, instance, seconds) {
  const deadline = performance.now() + seconds * 1000;
  const options = () => {
    const remaining = Math.floor(deadline - performance.now());
    if (remaining < 1) throw new Error('report time budget exhausted');
    return { ms: Math.min(5000, remaining) };
  };
  const issues = [];
  const measure = async (label, action) => {
    try {
      if (performance.now() >= deadline) throw new Error('report time budget exhausted');
      return await action();
    } catch (error) {
      issues.push(`${label}: ${error.message}`);
      return null;
    }
  };

  const filesystem = await measure('Host filesystem', () => {
    const { bsize, blocks, bfree, bavail, files, ffree } = statfsSync('/');
    return { bytes: bsize * blocks, usedBytes: bsize * (blocks - bfree), availableBytes: bsize * bavail, inodes: files, freeInodes: ffree };
  });
  const root = await measure('Docker data root', () => dockerRoot(docker, options()));
  const mounts = await measure('Host mounts', () => mountTable());
  const rows = (await measure('Docker containers', () => inventory(docker, options, { onError: message => issues.push(message) }))) ?? [];
  const records = rows.length
    ? await measure('Start-command records', async () => {
        const query = { ids: rows.map(row => row.id), uuids: rows.flatMap(row => (executionId.test(row.execution) ? [row.execution.toLowerCase()] : [])) };
        return (await taskRecords(docker, instance, query, options)).data;
      })
    : [];

  const usage = async (path, excludes = []) => {
    if (!absolute(path) || !mounts) throw new Error('path or mount boundaries unavailable');
    const real = realpathSync(path);
    const nested = mounts.filter(mount => mount.path !== real && within(mount.path, real)).map(mount => mount.path);
    // du treats exclusions as patterns, including literal mount paths containing metacharacters.
    const patterns = [...new Set([...nested, ...excludes])].map(p => p.replace(/[\\*?[\]]/g, '\\$&'));
    const text = await output('du', ['-sx', '-B1', ...patterns.map(p => `--exclude=${p}`), '--', real], options());
    const bytes = Number(/^\d+(?=\s)/.exec(text)?.[0]);
    if (!Number.isSafeInteger(bytes)) throw new Error('invalid disk measurement');
    return bytes;
  };

  const taskLinks = correlate(rows, records ?? []);
  const containers = [];
  for (const [index, row] of rows.entries()) {
    const writableBytes = await measure(`${row.name} writable layer`, async () => {
      if (!root) throw new Error('Docker root unavailable');
      return usage(await upperDirectory(row, root, options));
    });
    const logBytes = await measure(`${row.name} Docker log`, () => {
      if (!absolute(row.logPath)) throw new Error('file-backed Docker log unavailable');
      const file = lstatSync(row.logPath);
      if (!file.isFile()) throw new Error('Docker log is not a regular file');
      return file.blocks * 512;
    });
    containers.push({ id: row.id, name: row.name, image: row.image, state: row.state.Status, ...taskLinks[index], writableBytes, logBytes });
  }

  const imageList = await measure('Docker images', async () => {
    const lines = await docker(['image', 'ls', '--no-trunc', '--format', '{{json .}}'], options());
    const byId = new Map();
    for (const line of lines.split('\n').filter(Boolean)) {
      const image = JSON.parse(line);
      const entry = byId.get(image.ID) ?? { id: image.ID, tags: [], size: image.Size };
      if (image.Repository !== '<none>') entry.tags.push(`${image.Repository}:${image.Tag}`);
      byId.set(image.ID, entry);
    }
    return [...byId.values()];
  });

  const volumes = [];
  const names = await measure('Docker volumes', () => docker(['volume', 'ls', '-q'], options()));
  const listed = names?.split('\n').filter(Boolean) ?? [];
  if (listed.length > 100) issues.push(`Volume measurements limited to 100 of ${listed.length} volumes`);
  for (const name of listed.slice(0, 100)) {
    const bytes = await measure(`Volume ${name}`, async () => {
      const data = await docker(['volume', 'inspect', '--format', '{{json .}}', '--', name], options());
      const volume = JSON.parse(data);
      if (volume.Driver !== 'local' || Object.keys(volume.Options ?? {}).length) throw new Error('external or specially mounted volume');
      return usage(volume.Mountpoint);
    });
    volumes.push({ name, bytes });
  }

  const metadata = [];
  const daemonPaths = root ? [`${root}/containers`, `${root}/buildkit`, `${root}/image`, `${root}/containerd/daemon/io.containerd.metadata.v1.bolt`, '/var/lib/containerd/io.containerd.metadata.v1.bolt'] : [];
  for (const path of daemonPaths) {
    const bytes = await measure(path, async () => {
      // Missing driver-specific directories do not indicate a failed measurement.
      try {
        lstatSync(path);
      } catch (error) {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      }
      return usage(path);
    });
    if (bytes !== undefined) metadata.push({ path, bytes });
  }
  const host = [];
  for (const path of hostPaths) {
    const bytes = await measure(path, async () => {
      try {
        lstatSync(path);
      } catch (error) {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      }
      if (!root) throw new Error('cannot exclude the Docker data root');
      const excludes = [root, ...runtimeRoots];
      try {
        excludes.push(realpathSync(root));
      } catch (error) {
        if (!['EACCES', 'EPERM', 'ENOENT'].includes(error.code)) throw error;
      }
      if (excludes.some(base => within(path, base))) return undefined;
      return usage(path, excludes);
    });
    if (bytes !== undefined) host.push({ path, bytes });
  }

  return {
    complete: issues.length === 0,
    issues,
    filesystem,
    dockerRoot: root,
    containers,
    images: imageList,
    volumes,
    metadata,
    host,
    accounting: 'Measurements can overlap. Image sizes include shared layers. Container log sizes exclude rotated files. Daemon metadata can include container logs.',
  };
}
