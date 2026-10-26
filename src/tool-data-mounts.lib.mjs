/** Native data/config separation for agent 0.27.0 and OpenCode 1.19.4.
 *
 * Share the parent of auth.json, not its initial inode: native rename, unlink
 * and reauthentication must reach the same directory. Conversation databases,
 * WAL sidecars, indexes and snapshots also live here. Configuration and caches
 * use separate XDG roots. agent's legacy data/bin executable cache is the one
 * exception and receives a private tmpfs in every task.
 *
 * This is a storage projection, not a cross-process OAuth refresh coordinator.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

export const SHARED_TOOL_DATA_ENV = 'HIVE_MIND_SHARED_TOOL_DATA';
const containerData = '/home/box/.local/share';
const apps = Object.freeze({ agent: 'link-assistant-agent', opencode: 'opencode' });
const refused = () => new Error('Shared tool data storage could not be established. Persist the selected XDG data directory in a host-backed mount; private data fallback is prohibited.');
const safePath = value => typeof value === 'string' && path.isAbsolute(value) && path.normalize(value) === value && !/[\0\r\n,:]/u.test(value);

export function toolDataMount({ tool, homeDir, env = process.env } = {}) {
  const app = apps[String(tool || '').toLowerCase()];
  if (!app) return null;
  const data = env.XDG_DATA_HOME || path.join(homeDir, '.local/share');
  if (!safePath(data)) throw refused();
  return { source: path.join(data, app), target: path.join(containerData, app) };
}

async function verifyAncestors(target, io, { allowMissing = false } = {}) {
  let current = path.parse(target).root;
  for (const part of target.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    const info = await io.lstat(current).catch(error => {
      if (allowMissing && error.code === 'ENOENT') return null;
      throw error;
    });
    if (!info && allowMissing) return;
    if (!info.isDirectory() || info.isSymbolicLink()) throw refused();
  }
}

export async function prepareToolDataMount({ tool, homeDir, env, io } = {}) {
  const mount = toolDataMount({ tool, homeDir, env });
  if (!mount) return null;
  try {
    await verifyAncestors(mount.source, io, { allowMissing: true });
    const present = await io.lstat(mount.source).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (!present) await io.mkdir(mount.source, { recursive: true, mode: 0o700 });
    await verifyAncestors(mount.source, io);
    const info = await io.stat(mount.source, { bigint: true });
    return { created: present ? [] : [mount.source], identity: `${info.dev}:${info.ino}` };
  } catch {
    throw refused();
  }
}

export function toolDataContainerEnv({ tool, identity = null, useRouter = false } = {}) {
  const app = apps[String(tool || '').toLowerCase()];
  if (!app || useRouter) return {};
  return {
    XDG_DATA_HOME: containerData,
    ...(identity ? { [SHARED_TOOL_DATA_ENV]: JSON.stringify({ schema: 1, tool, target: path.join(containerData, app), identity }) } : {}),
  };
}

export function toolDataPrivateMounts({ tool, useRouter = false } = {}) {
  // Docker's tmpfs is deliberately non-executable. The pinned image supplies
  // rg on PATH, which agent prefers to its download cache. Do not inherit or
  // execute operator-cached binaries from the data authority.
  return !useRouter && tool === 'agent' ? [`type=tmpfs,destination=${containerData}/link-assistant-agent/bin,tmpfs-mode=1777,tmpfs-size=134217728`] : [];
}

/** Recheck the effective directory immediately before launching a native CLI.
 * The parent records this identity before the daemon-namespace mount probe.
 * The environment marker is structural metadata; it contains no credentials.
 */
export async function assertSharedToolData({ tool, env = process.env, io = fs, homeDir = os.homedir() } = {}) {
  if (!env[SHARED_TOOL_DATA_ENV]) return;
  try {
    const expected = JSON.parse(env[SHARED_TOOL_DATA_ENV]);
    const effective = toolDataMount({ tool, env, homeDir });
    if (expected.schema !== 1 || expected.tool !== tool || !effective || expected.target !== effective.source) throw refused();
    await verifyAncestors(effective.source, io);
    const info = await io.stat(effective.source, { bigint: true });
    if (`${info.dev}:${info.ino}` !== expected.identity) throw refused();
    if (tool === 'opencode' && (env.OPENCODE_AUTH_CONTENT || (env.OPENCODE_DB && env.OPENCODE_DB !== path.join(effective.source, 'opencode.db')))) throw refused();
    const configs = [path.join(env.XDG_CONFIG_HOME || path.join(homeDir, '.config'), apps[tool])];
    const prefix = tool === 'agent' ? 'LINK_ASSISTANT_AGENT' : 'OPENCODE';
    if (env[`${prefix}_CONFIG_DIR`]) configs.push(env[`${prefix}_CONFIG_DIR`]);
    const privateRoots = [...configs, path.join(env.XDG_CACHE_HOME || path.join(homeDir, '.cache'), apps[tool]), path.join(env.XDG_STATE_HOME || path.join(homeDir, '.local/state'), apps[tool])];
    for (const root of privateRoots) {
      if (!safePath(root) || root === effective.source || root.startsWith(`${effective.source}${path.sep}`) || effective.source.startsWith(`${root}${path.sep}`)) throw refused();
      await verifyAncestors(root, io, { allowMissing: true });
    }
    const configFile = env[`${prefix}_CONFIG`];
    if (configFile) {
      if (!safePath(configFile) || configFile === effective.source || configFile.startsWith(`${effective.source}${path.sep}`)) throw refused();
      await verifyAncestors(path.dirname(configFile), io, { allowMissing: true });
      const info = await io.lstat(configFile).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (info && (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)) throw refused();
    }
  } catch {
    throw refused();
  }
}
