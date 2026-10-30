// Selected native experiment only. Account display metadata shares canonical
// storage and the credential transaction lock, independently of configuration.
import * as sync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';

const LIMIT = 1024 * 1024;
const NAME = 'google_accounts.json';
const refused = () => new Error('Gemini canonical account storage is unavailable or unsafe.');
const identity = info => `${info.dev}:${info.ino}`;
const version = info => `${identity(info)}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.mode}:${info.nlink}`;
const safe = info => info.isFile() && info.nlink === 1n && info.uid === BigInt(process.getuid()) && (info.mode & 0o077n) === 0n && info.size <= BigInt(LIMIT);
const generation = credentials => createHash('sha256').update('gemini-account-generation\0').update(credentials.refresh_token).digest('hex');
let authority;

function context(privateFile, privateCredentialFile) {
  try {
    const directory = process.env.GEMINI_AUTH_HOME;
    if (process.platform !== 'linux' || !path.isAbsolute(directory) || path.normalize(directory) !== directory || directory === path.parse(directory).root || /[\0\r\n]/u.test(directory)) throw refused();
    const info = sync.lstatSync(directory, { bigint: true });
    if (!info.isDirectory() || info.uid !== BigInt(process.getuid()) || (info.mode & 0o077n) !== 0n || sync.realpathSync(directory) !== directory) throw refused();
    if (authority && (authority.directory !== directory || authority.identity !== identity(info) || authority.privateFile !== privateFile || authority.privateCredentialFile !== privateCredentialFile)) throw refused();
    authority ??= { directory, identity: identity(info), privateFile, privateCredentialFile };
    for (const [candidate, canonical] of [
      [privateFile, NAME],
      [privateCredentialFile, 'oauth_creds.json'],
    ]) {
      if (candidate === path.join(directory, canonical)) continue;
      try {
        sync.lstatSync(candidate);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw refused();
      }
      throw refused();
    }
    return authority;
  } catch {
    throw refused();
  }
}

function admit() {
  if (!authority) throw refused();
  return context(authority.privateFile, authority.privateCredentialFile);
}

// Native account getters are synchronous. Use the same descriptor, no-follow,
// size and before/after identity checks as the asynchronous credential reader.
function read(name) {
  let directory;
  let handle;
  try {
    const state = admit();
    directory = sync.openSync(state.directory, sync.constants.O_RDONLY | sync.constants.O_DIRECTORY | sync.constants.O_NOFOLLOW);
    if (identity(sync.fstatSync(directory, { bigint: true })) !== state.identity) throw refused();
    const anchored = `/proc/self/fd/${directory}/${name}`;
    let before;
    try {
      before = sync.lstatSync(anchored, { bigint: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        admit();
        return null;
      }
      throw error;
    }
    if (!safe(before)) throw refused();
    handle = sync.openSync(anchored, sync.constants.O_RDONLY | sync.constants.O_NOFOLLOW | sync.constants.O_NONBLOCK);
    const opened = sync.fstatSync(handle, { bigint: true });
    if (!safe(opened) || version(opened) !== version(before)) throw refused();
    const bytes = Buffer.alloc(LIMIT + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = sync.readSync(handle, bytes, length, bytes.length - length, length);
      if (count === 0) break;
      length += count;
    }
    const after = sync.lstatSync(anchored, { bigint: true });
    if (length > LIMIT || BigInt(length) !== opened.size || !safe(after) || version(after) !== version(opened) || version(sync.fstatSync(handle, { bigint: true })) !== version(opened)) throw refused();
    admit();
    const value = JSON.parse(bytes.subarray(0, length).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw refused();
    return { value, version: version(after) };
  } catch {
    throw refused();
  } finally {
    try {
      if (handle !== undefined) sync.closeSync(handle);
    } finally {
      if (directory !== undefined) sync.closeSync(directory);
    }
  }
}

function accounts() {
  const existing = read(NAME);
  if (!existing) return { existing: null, value: { version: 1, generation: null, active: null, old: [] } };
  const value = existing.value;
  const email = input => typeof input === 'string' && input.length > 0 && input.length <= 1024 && !/[\0\r\n]/u.test(input);
  if (value.version !== 1 || !(value.generation === null || /^[a-f0-9]{64}$/u.test(value.generation)) || !(value.active === null || email(value.active)) || !Array.isArray(value.old) || value.old.length > 4096 || !value.old.every(email)) throw refused();
  return { existing, value };
}

export function readNativeGeminiAccounts(privateFile, privateCredentialFile) {
  context(privateFile, privateCredentialFile);
  const { value } = accounts();
  if (value.active === null) return value;
  const credentials = read('oauth_creds.json')?.value;
  if (credentials && (typeof credentials.refresh_token !== 'string' || !credentials.refresh_token)) throw refused();
  if (!credentials || generation(credentials) !== value.generation) return { ...value, active: null, old: [...new Set([...value.old, value.active])] };
  return value;
}

export function getNativeGeminiAccountsPath(privateFile, privateCredentialFile) {
  return path.join(context(privateFile, privateCredentialFile).directory, NAME);
}

export function bindNativeGeminiAccounts({ privateFile, privateCredentialFile, withTransaction }) {
  const state = context(privateFile, privateCredentialFile);
  state.withTransaction = withTransaction;
  accounts();
}

export function validateNativeGeminiAccounts() {
  admit();
  accounts();
}

async function discard(directory, name, created) {
  if (!created || !directory) return;
  try {
    const entry = `/proc/self/fd/${directory.fd}/${name}`;
    if (identity(await fs.lstat(entry, { bigint: true })) === identity(created)) await fs.unlink(entry);
  } catch (error) {
    if (error.code !== 'ENOENT') throw refused();
  }
}

async function publish(value, previous) {
  let directory;
  let handle;
  let created;
  const name = `.hive-gemini-accounts-${process.pid}-${randomUUID()}`;
  try {
    const state = admit();
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > LIMIT) throw refused();
    directory = await fs.open(state.directory, sync.constants.O_RDONLY | sync.constants.O_DIRECTORY | sync.constants.O_NOFOLLOW);
    if (identity(await directory.stat({ bigint: true })) !== state.identity) throw refused();
    const entry = item => `/proc/self/fd/${directory.fd}/${item}`;
    handle = await fs.open(entry(name), sync.constants.O_WRONLY | sync.constants.O_CREAT | sync.constants.O_EXCL | sync.constants.O_NOFOLLOW, 0o600);
    created = await handle.stat({ bigint: true });
    await handle.writeFile(serialized);
    await handle.sync();
    await handle.close();
    handle = null;
    admit();
    if (read(NAME)?.version !== previous?.version) throw refused();
    const staged = await fs.lstat(entry(name), { bigint: true });
    if (!safe(staged) || identity(staged) !== identity(created)) throw refused();
    await fs.rename(entry(name), entry(NAME));
    await directory.sync();
    if (JSON.stringify(read(NAME)?.value) !== serialized) throw refused();
  } catch {
    throw refused();
  } finally {
    try {
      await handle?.close();
      await discard(directory, name, created);
    } finally {
      await directory?.close();
    }
  }
}

async function update(operation) {
  const state = admit();
  if (typeof state.withTransaction !== 'function') throw refused();
  return state.withTransaction(path.join(state.directory, 'oauth_creds.json'), async transaction => {
    admit();
    const current = await transaction.snapshot(true);
    const { value, existing } = accounts();
    const next = await operation(value, current?.credentials);
    await transaction.assertCurrent();
    if (next) await publish(next, existing);
  });
}

export function cacheNativeGeminiAccount(email, credentials) {
  if (typeof email !== 'string' || !email || email.length > 1024 || /[\0\r\n]/u.test(email)) throw refused();
  return update((value, current) => {
    if (!current || !credentials || current.access_token !== credentials.access_token || current.refresh_token !== credentials.refresh_token) throw refused();
    return { version: 1, generation: generation(current), active: email, old: [...new Set([...value.old, ...(value.active ? [value.active] : [])])].filter(item => item !== email) };
  });
}

export function refreshNativeGeminiAccount(previous, current) {
  return update(value => (value.active && value.generation === generation(previous) ? { ...value, generation: generation(current) } : null));
}

export function clearNativeGeminiAccount() {
  return update(value => ({ version: 1, generation: null, active: null, old: [...new Set([...value.old, ...(value.active ? [value.active] : [])])] }));
}
