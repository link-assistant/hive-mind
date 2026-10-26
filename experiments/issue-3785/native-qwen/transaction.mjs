// Pinned native experiment. Every OAuth writer must use this transaction;
// production launchers do not install it yet.
import fs from 'node:fs/promises';
import { constants, lstatSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import path from 'node:path';
import process from 'node:process';
import { withSharedAuthRefreshLock } from '../../../src/shared-auth-refresh-lock.lib.mjs';
import { readNativeQwenCredentials } from './read_credentials.mjs';

const context = new AsyncLocalStorage();
const INTENT = '.hive-qwen-refresh-intent.json';
const LIMIT = 1024 * 1024;
const refused = () => new Error('Qwen canonical authentication is unavailable or unsafe.');
const identity = info => `${info.dev}:${info.ino}`;
const version = info => `${identity(info)}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.mode}:${info.nlink}`;
const digest = credentials => createHash('sha256').update(JSON.stringify(credentials)).digest('hex');
const safe = (info, limit = LIMIT) => info.isFile() && info.nlink === 1n && info.uid === BigInt(process.getuid()) && (info.mode & 0o077n) === 0n && info.size <= BigInt(limit);

export function nativeQwenCredentialPath(configurationDirectory) {
  const selected = process.env.QWEN_AUTH_HOME;
  if (selected === undefined) return path.join(configurationDirectory, 'oauth_creds.json');
  if (!path.isAbsolute(selected) || path.normalize(selected) !== selected || selected === path.parse(selected).root || /[\0\r\n]/u.test(selected)) throw refused();
  if (selected !== configurationDirectory) {
    try {
      lstatSync(path.join(configurationDirectory, 'oauth_creds.json'));
    } catch (error) {
      if (error.code === 'ENOENT') return path.join(selected, 'oauth_creds.json');
      throw refused();
    }
    // A second native authority is a conflict, including an identical copy or
    // a symlink. Never copy, merge, delete or silently prefer one of them.
    throw refused();
  }
  return path.join(selected, 'oauth_creds.json');
}

export function nativeQwenTransactionActive(file) {
  const active = context.getStore();
  return active?.active === true && active.file === file;
}

export async function withNativeQwenTransaction(file, operation, { signal } = {}) {
  const inherited = context.getStore();
  if (inherited?.active) {
    if (inherited.file !== file) throw refused();
    await inherited.transaction.assertCurrent();
    return operation(inherited.transaction);
  }
  let directory;
  try {
    const parent = path.dirname(file);
    if (process.platform !== 'linux' || !path.isAbsolute(file) || path.normalize(file) !== file || /[\0\r\n]/u.test(file)) throw refused();
    directory = await fs.open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const openedDirectory = await directory.stat({ bigint: true });
    const entry = name => `/proc/self/fd/${directory.fd}/${name}`;
    return await withSharedAuthRefreshLock({ directory: parent, signal }, async ({ assertCurrent: assertLock }) => {
      async function assertCurrent() {
        await assertLock();
        const current = await fs.lstat(parent, { bigint: true });
        if (identity(current) !== identity(openedDirectory)) throw refused();
        // An old unpatched writer might still own this legacy lock. Do not
        // speculate about its age or delete it during an upgrade.
        if (await inspect('oauth_creds.lock', 1024)) throw refused();
      }
      async function inspect(name, limit = LIMIT) {
        try {
          const info = await fs.lstat(entry(name), { bigint: true });
          if (!safe(info, limit)) throw refused();
          return info;
        } catch (error) {
          if (error.code === 'ENOENT') return null;
          throw refused();
        }
      }
      async function snapshot(allowMissing = false) {
        await assertCurrent();
        const before = await inspect(path.basename(file));
        if (!before) {
          if (!allowMissing) throw refused();
          return null;
        }
        const credentials = await readNativeQwenCredentials(file);
        const after = await inspect(path.basename(file));
        if (!after || version(before) !== version(after)) throw refused();
        await assertCurrent();
        return { credentials, version: version(after), digest: digest(credentials) };
      }
      async function intent() {
        const before = await inspect(INTENT, 1024);
        if (!before) return null;
        let handle;
        try {
          handle = await fs.open(entry(INTENT), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          const bytes = Buffer.alloc(1025);
          const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
          const after = await inspect(INTENT, 1024);
          if (!after || version(before) !== version(after) || version(await handle.stat({ bigint: true })) !== version(before) || BigInt(bytesRead) !== before.size) throw refused();
          const parsed = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
          if (parsed.version !== 1 || !/^[a-f0-9]{64}$/u.test(parsed.generation)) throw refused();
          return parsed;
        } finally {
          await handle?.close();
        }
      }
      async function clearIntent() {
        if (await intent()) {
          await assertCurrent();
          await fs.unlink(entry(INTENT));
          await directory.sync();
        }
      }
      async function reconcile(current) {
        const pending = await intent();
        if (!pending) return;
        // Owner death after exchange but before publication cannot justify
        // consuming the predecessor again. A different durable generation can
        // complete recovery after a crash between publication and marker clear.
        if (!current || current.digest === pending.generation) throw refused();
        let handle;
        try {
          handle = await fs.open(entry(path.basename(file)), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          if (version(await handle.stat({ bigint: true })) !== current.version) throw refused();
          await handle.sync();
          await directory.sync();
          if ((await snapshot()).version !== current.version) throw refused();
          await clearIntent();
        } finally {
          await handle?.close();
        }
      }
      async function beginRefresh(current) {
        await assertCurrent();
        await reconcile(current);
        if ((await snapshot()).version !== current.version) throw refused();
        let handle;
        try {
          handle = await fs.open(entry(INTENT), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          await handle.writeFile(JSON.stringify({ version: 1, generation: current.digest }));
          await handle.sync();
          await directory.sync();
          await assertCurrent();
        } finally {
          await handle?.close();
        }
      }
      async function write(credentials, expected) {
        await assertCurrent();
        const previous = await snapshot(true);
        if (expected !== undefined && previous?.version !== expected?.version) throw refused();
        for (const name of ['access_token', 'refresh_token', 'token_type']) if (typeof credentials[name] !== 'string' || credentials[name].length === 0) throw refused();
        if (!Number.isFinite(credentials.expiry_date) || credentials.expiry_date <= 0) throw refused();
        const serialized = JSON.stringify(credentials);
        if (Buffer.byteLength(serialized) > LIMIT) throw refused();
        const pending = await intent();
        if (pending && pending.generation === digest(credentials)) throw refused();
        const temporary = `.hive-qwen-auth-${process.pid}-${randomUUID()}`;
        let handle;
        let created;
        try {
          handle = await fs.open(entry(temporary), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          created = await handle.stat({ bigint: true });
          await handle.writeFile(serialized);
          await handle.sync();
          await handle.close();
          handle = null;
          await assertCurrent();
          if ((await snapshot(true))?.version !== previous?.version) throw refused();
          const staged = await inspect(temporary);
          if (!staged || identity(staged) !== identity(created)) throw refused();
          await fs.rename(entry(temporary), entry(path.basename(file)));
          await directory.sync();
          const published = await snapshot();
          if (published.digest !== digest(credentials)) throw refused();
          await clearIntent();
          return published.credentials;
        } finally {
          await handle?.close();
          // Clean up only our own unpublished inode. Keep replaced evidence.
          const staged = await inspect(temporary);
          if (created && staged && identity(staged) === identity(created)) await fs.unlink(entry(temporary));
        }
      }
      async function remove() {
        await assertCurrent();
        await intent();
        if (await snapshot(true)) {
          await fs.unlink(entry(path.basename(file)));
          await directory.sync();
        }
        await clearIntent();
        await assertCurrent();
      }
      const transaction = { assertCurrent, snapshot, reconcile, beginRefresh, write, remove };
      await assertCurrent();
      const state = { active: true, file, transaction };
      try {
        return await context.run(state, () => operation(transaction));
      } finally {
        state.active = false;
      }
    });
  } catch {
    throw refused();
  } finally {
    await directory?.close();
  }
}
