/** Read the selected native credential authority without private-home fallback. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';

const refused = () => new Error('Canonical Codex authentication storage is unavailable or unsafe.');
const revision = info => `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
const absoluteStoragePath = root => typeof root === 'string' && path.isAbsolute(root) && root !== path.parse(root).root && path.normalize(root) === root && !/[\0\r\n]/u.test(root);

export function selectedCodexAuthHome(env = process.env) {
  if (env.CODEX_AUTH_HOME === undefined) return null;
  const root = env.CODEX_AUTH_HOME;
  if (!absoluteStoragePath(root)) throw refused();
  return root;
}

export async function readCanonicalCodexAuth(root, { configurationHome } = {}) {
  let directory;
  let descriptor;
  try {
    const assertSingleAuthority = async () => {
      if (!absoluteStoragePath(configurationHome)) throw refused();
      if (configurationHome === root) return;
      const privateAuth = await fs.lstat(path.join(configurationHome, 'auth.json')).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (privateAuth) throw refused();
    };
    await assertSingleAuthority();
    if (process.platform !== 'linux' || selectedCodexAuthHome({ CODEX_AUTH_HOME: root }) !== root || (await fs.realpath(root)) !== root) throw refused();
    const owner = BigInt(process.getuid());
    directory = await fs.open(root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const held = await directory.stat({ bigint: true });
    if (!held.isDirectory() || held.uid !== owner || (held.mode & 0o077n) !== 0n) throw refused();
    const anchored = `/proc/self/fd/${directory.fd}/auth.json`;
    descriptor = await fs.open(anchored, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = await descriptor.stat({ bigint: true });
    if (!before.isFile() || before.uid !== owner || before.nlink !== 1n || (before.mode & 0o077n) !== 0n || before.size <= 0n || before.size > 1024n * 1024n) throw refused();
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await descriptor.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const visible = await fs.lstat(root, { bigint: true });
    if (BigInt(offset) !== before.size || revision(before) !== revision(await descriptor.stat({ bigint: true })) || revision(before) !== revision(await fs.lstat(anchored, { bigint: true })) || !visible.isDirectory() || visible.dev !== held.dev || visible.ino !== held.ino || visible.uid !== owner || (visible.mode & 0o077n) !== 0n || (await fs.realpath(root)) !== root) throw refused();
    await assertSingleAuthority();
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, offset)));
  } catch {
    throw refused();
  } finally {
    try {
      await descriptor?.close();
    } finally {
      await directory?.close();
    }
  }
}
