// Pinned native Qwen experiment only; production launchers do not load this.
// Every read observes disk authority. Do not cache by timestamps or reuse a
// client credential after logout, malformed storage or a failed inspection.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';

const LIMIT = 1024 * 1024;
const refused = () => new Error('Qwen credential storage is unavailable or unsafe.');
const identity = info => `${info.dev}:${info.ino}`;
const version = info => `${identity(info)}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.mode}:${info.nlink}`;
const safeFile = info => info.isFile() && info.nlink === 1n && info.uid === BigInt(process.getuid()) && (info.mode & 0o077n) === 0n && info.size <= BigInt(LIMIT);

export async function readNativeQwenCredentials(file) {
  let directory;
  let handle;
  try {
    const parent = path.dirname(file);
    if (process.platform !== 'linux' || !path.isAbsolute(file) || path.normalize(file) !== file || parent === path.parse(parent).root || /[\0\r\n]/u.test(file) || (await fs.realpath(parent)) !== parent) throw refused();
    directory = await fs.open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const openedDirectory = await directory.stat({ bigint: true });
    const assertDirectory = async () => {
      const current = await fs.lstat(parent, { bigint: true });
      if (!current.isDirectory() || current.uid !== BigInt(process.getuid()) || (current.mode & 0o077n) !== 0n || identity(current) !== identity(openedDirectory) || (await fs.realpath(parent)) !== parent) throw refused();
    };
    await assertDirectory();
    const anchored = `/proc/self/fd/${directory.fd}/${path.basename(file)}`;
    const before = await fs.lstat(anchored, { bigint: true });
    if (!safeFile(before)) throw refused();
    // Nonblocking prevents a substituted FIFO from hanging before fstat.
    handle = await fs.open(anchored, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = await handle.stat({ bigint: true });
    if (!safeFile(opened) || version(opened) !== version(before)) throw refused();
    const bytes = Buffer.alloc(LIMIT + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length);
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    const after = await fs.lstat(anchored, { bigint: true });
    if (length > LIMIT || BigInt(length) !== opened.size || !safeFile(after) || version(after) !== version(opened) || version(await handle.stat({ bigint: true })) !== version(opened)) throw refused();
    await assertDirectory();
    const parsed = JSON.parse(bytes.subarray(0, length).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw refused();
    for (const field of ['access_token', 'refresh_token', 'token_type']) {
      if (typeof parsed[field] !== 'string' || parsed[field].length === 0) throw refused();
    }
    if (!Number.isFinite(parsed.expiry_date) || parsed.expiry_date <= 0) throw refused();
    return parsed;
  } catch {
    // Never include paths, credential bytes or JSON parser excerpts.
    throw refused();
  } finally {
    await handle?.close();
    await directory?.close();
  }
}
