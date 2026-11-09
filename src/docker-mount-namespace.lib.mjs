/** Resolve launcher paths in the selected Docker daemon's filesystem. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { startDetachedDockerPull } from './docker-pull-detached.lib.mjs';
import { TASK_IMAGE_PULL_TIMEOUT_MS } from './task-image-refresh.lib.mjs';

const execute = promisify(execFile);
const refused = () => new Error('Docker mount backing could not be verified. Persist the source in a root-container bind or volume visible to the selected local daemon before launching a task.');
const validPath = value => typeof value === 'string' && path.posix.isAbsolute(value) && path.posix.normalize(value) === value && !/[\0\r\n,:]/u.test(value);
const identity = info => `${info.dev}:${info.ino}:${info.isDirectory() ? 'directory' : 'file'}`;
const pullMissingImage = ({ image, env }) => startDetachedDockerPull(['pull', image], { timeoutMs: TASK_IMAGE_PULL_TIMEOUT_MS, spawnImpl: (binary, args, options) => spawn(binary, args, { ...options, env }) });

export function mapDockerMountSources(mounts, parentMounts) {
  if (!Array.isArray(parentMounts)) throw refused();
  return mounts.map(mount => {
    if (!validPath(mount.source) || !validPath(mount.target)) throw refused();
    const candidates = parentMounts.filter(parent => validPath(parent?.Destination) && (mount.source === parent.Destination || mount.source.startsWith(`${parent.Destination === '/' ? '' : parent.Destination}/`)));
    candidates.sort((left, right) => right.Destination.length - left.Destination.length);
    if (!candidates.length || (candidates[1] && candidates[0].Destination === candidates[1].Destination)) throw refused();
    const parent = candidates[0];
    if (!['bind', 'volume'].includes(parent.Type) || !validPath(parent.Source)) throw refused();
    return { ...mount, source: path.posix.join(parent.Source, path.posix.relative(parent.Destination, mount.source)) };
  });
}

async function parentContainerId(io) {
  const handle = await io.open('/proc/self/mountinfo', 'r');
  try {
    const buffer = Buffer.alloc(128 * 1024);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size === buffer.length) throw refused();
    const ids = new Set([...buffer.toString('utf8', 0, size).matchAll(/\/containers\/([a-f0-9]{64})\/(?:hostname|hosts|resolv\.conf)\s/gu)].map(match => match[1]));
    if (ids.size !== 1) throw refused();
    return [...ids][0];
  } finally {
    await handle.close();
  }
}

/** No auth/history content is read. The read-only probe runs only stat, with
 * no network or image entrypoint, and compares actual device/inode identities.
 * A missing task image is pulled using the existing detached-pull lifecycle.
 * The probe itself never pulls. A wrong or inaccessible source
 * rejects launch instead of letting Docker create a private replacement.
 */
export async function resolveDockerIsolationMountSources({ mounts, image, env = process.env, run = execute, io = fs, pull = pullMissingImage }) {
  if (!Array.isArray(mounts) || mounts.length > 64 || typeof image !== 'string' || image.length > 512 || !/^[a-z0-9][^\s]*$/iu.test(image)) throw refused();
  if (!mounts.length) return [];
  const trace = stage => {
    if (env.HIVE_MIND_DOCKER_MOUNT_TRACE === '1') console.error(`[docker-mount-backing] ${stage}`);
  };
  const docker = (args, maxBuffer = 128 * 1024) => run('docker', args, { env, maxBuffer, signal: AbortSignal.timeout(30_000) });
  const snapshot = async () => {
    const result = [];
    for (const mount of mounts) {
      if (!validPath(mount.source) || !validPath(mount.target)) throw refused();
      const info = await io.lstat(mount.source, { bigint: true });
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw refused();
      result.push(identity(info));
    }
    return result;
  };
  try {
    trace('checking local daemon');
    const endpoint = env.DOCKER_HOST || JSON.parse((await docker(['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'])).stdout);
    // Device/inode comparison attests a common local kernel; it must not be
    // mistaken for identity across unrelated remote Docker hosts.
    if (typeof endpoint !== 'string' || !endpoint.startsWith('unix:///')) throw refused();
    const expected = await snapshot();
    trace('checking local image');
    try {
      await docker(['image', 'inspect', '--format', '{{.Id}}', image]);
    } catch {
      await pull({ image, env });
      await docker(['image', 'inspect', '--format', '{{.Id}}', image]);
    }
    const verify = async candidates => {
      const name = `hive-mount-probe-${randomUUID()}`;
      const args = ['run', '--rm', '--name', name, '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '32', '--ulimit', 'data=1073741824:1073741824', '--env', 'NODE_OPTIONS=', '--entrypoint', 'node'];
      for (const [index, candidate] of candidates.entries()) args.push('--mount', `type=bind,source=${candidate.source},target=/__hive_mount_probe/${index},readonly`);
      args.push(image, '--max-old-space-size=64', '-e', 'const fs=require("node:fs");console.log(JSON.stringify(Array.from({length:Number(process.argv[1])},(_,index)=>{const s=fs.statSync("/__hive_mount_probe/"+index,{bigint:true});return `${s.dev}:${s.ino}:${s.isDirectory()?"directory":"file"}`;})));', String(candidates.length));
      try {
        const { stdout } = await docker(args);
        if (JSON.stringify(JSON.parse(stdout)) !== JSON.stringify(expected)) throw refused();
      } finally {
        // Reap even when the client aborts or a filesystem operation stalls.
        await docker(['rm', '-f', name]).catch(() => {});
      }
    };
    let resolved = mounts;
    try {
      trace('probing input sources');
      await verify(resolved);
    } catch {
      trace('translating rejected input sources');
      const id = await parentContainerId(io);
      const { stdout } = await docker(['inspect', '--type', 'container', '--format', '{{json .Mounts}}', id]);
      resolved = mapDockerMountSources(mounts, JSON.parse(stdout));
      trace('probing mapped sources');
      await verify(resolved);
    }
    if (JSON.stringify(await snapshot()) !== JSON.stringify(expected)) throw refused();
    trace('verified');
    return resolved;
  } catch {
    trace('rejected');
    // Docker errors can contain operator paths and registry diagnostics.
    throw refused();
  }
}
