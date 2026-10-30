// Disposable pinned native experiment. Configuration and executable material
// stay private; only native conversation records use this selected authority.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';

const LIMIT = 32 * 1024 * 1024;
const identity = info => `${info.dev}:${info.ino}`;
const version = info => `${identity(info)}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.mode}:${info.nlink}`;
const digest = content => createHash('sha256').update(content).digest('hex');
const safeDirectory = info => info.isDirectory() && info.uid === BigInt(process.getuid()) && (info.mode & 0o077n) === 0n;
const safeFile = info => info.isFile() && info.uid === BigInt(process.getuid()) && info.nlink === 1n && (info.mode & 0o077n) === 0n && info.size <= BigInt(LIMIT);
const within = (parent, child) => child === parent || child.startsWith(parent + path.sep);
const directories = new Map();
const conversations = new Map();
const observed = new Map();
let authority;
let failed = false;

function refuse() {
  failed = true;
  return new Error('Gemini canonical conversation history is unavailable or unsafe.');
}

export function nativeGeminiHistorySelected() {
  return authority !== undefined || process.env.GEMINI_HISTORY_HOME !== undefined;
}

export function assertNativeGeminiHistoryCurrent() {
  if (!nativeGeminiHistorySelected()) return;
  try {
    if (failed || process.platform !== 'linux') throw refuse();
    const selected = process.env.GEMINI_HISTORY_HOME;
    if (typeof selected !== 'string' || !path.isAbsolute(selected) || path.normalize(selected) !== selected || selected === path.parse(selected).root || /[\0\r\n]/u.test(selected) || fs.realpathSync(selected) !== selected) throw refuse();
    if (!authority) {
      const before = fs.lstatSync(selected, { bigint: true });
      if (!safeDirectory(before)) throw refuse();
      const fd = fs.openSync(selected, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      const opened = fs.fstatSync(fd, { bigint: true });
      if (!safeDirectory(opened) || identity(opened) !== identity(before)) {
        fs.closeSync(fd);
        throw refuse();
      }
      authority = { selected, fd, identity: identity(opened) };
    }
    const current = fs.lstatSync(selected, { bigint: true });
    if (selected !== authority.selected || !safeDirectory(current) || identity(current) !== authority.identity) throw refuse();
    for (const item of directories.values()) {
      const named = fs.lstatSync(`/proc/self/fd/${item.parent}/${item.name}`, { bigint: true });
      const opened = fs.fstatSync(item.fd, { bigint: true });
      if (!safeDirectory(named) || !safeDirectory(opened) || identity(named) !== item.identity || identity(opened) !== item.identity) throw refuse();
    }
  } catch {
    throw refuse();
  }
}

function directory(components) {
  assertNativeGeminiHistoryCurrent();
  let parent = authority.fd;
  let prefix = '';
  for (const name of components) {
    if (!/^[a-zA-Z0-9_.-]{1,200}$/u.test(name) || ['.', '..'].includes(name)) throw refuse();
    prefix += '/' + name;
    let item = directories.get(prefix);
    if (!item) {
      if (directories.size >= 1024) throw refuse();
      const anchored = `/proc/self/fd/${parent}/${name}`;
      try {
        fs.mkdirSync(anchored, { mode: 0o700 });
        fs.fsyncSync(parent);
      } catch (error) {
        if (error.code !== 'EEXIST') throw refuse();
      }
      const before = fs.lstatSync(anchored, { bigint: true });
      if (!safeDirectory(before)) throw refuse();
      const fd = fs.openSync(anchored, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      const opened = fs.fstatSync(fd, { bigint: true });
      if (!safeDirectory(opened) || identity(opened) !== identity(before)) {
        fs.closeSync(fd);
        throw refuse();
      }
      item = { fd, parent, name, identity: identity(opened) };
      directories.set(prefix, item);
    }
    parent = item.fd;
  }
  assertNativeGeminiHistoryCurrent();
  return { fd: parent, anchor: `/proc/self/fd/${parent}`, components };
}

function checkedFile(location, missing = false) {
  assertNativeGeminiHistoryCurrent();
  try {
    const info = fs.lstatSync(location.target, { bigint: true });
    if (!safeFile(info)) throw refuse();
    return info;
  } catch (error) {
    if (missing && error.code === 'ENOENT') return null;
    throw refuse();
  }
}

function snapshot(location, missing = false) {
  const before = checkedFile(location, missing);
  if (!before) return null;
  const fd = fs.openSync(location.target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!safeFile(opened) || version(opened) !== version(before)) throw refuse();
    const bytes = Buffer.alloc(Number(opened.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, length);
      if (count === 0) break;
      length += count;
    }
    if (BigInt(length) !== opened.size || version(fs.fstatSync(fd, { bigint: true })) !== version(opened) || version(checkedFile(location)) !== version(opened)) throw refuse();
    assertNativeGeminiHistoryCurrent();
    return bytes.subarray(0, length).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function locked(parent, operation) {
  assertNativeGeminiHistoryCurrent();
  const target = `${parent.anchor}/.history.lock`;
  const fd = fs.openSync(target, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    const current = () => {
      assertNativeGeminiHistoryCurrent();
      const named = fs.lstatSync(target, { bigint: true });
      if (!safeFile(opened) || opened.size !== 0n || !safeFile(named) || named.size !== 0n || identity(named) !== identity(opened)) throw refuse();
    };
    current();
    // The parent's inherited open description retains the kernel lock after
    // flock exits. Parent death releases it without unlinking the stable inode.
    const result = spawnSync('flock', ['-x', '-w', '5', '3'], { env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'ignore', 'ignore', fd] });
    if (result.error || result.status !== 0) throw refuse();
    current();
    const value = operation(current);
    current();
    return value;
  } finally {
    fs.closeSync(fd);
  }
}

function publish(parent, name, content, current) {
  const temporary = `${parent.anchor}/.history-${randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
    current();
    fs.renameSync(temporary, `${parent.anchor}/${name}`);
    fs.fsyncSync(parent.fd);
    current();
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT') failed = true;
    }
  }
}

export function nativeGeminiChatsDirectory(configuration, projectRoot) {
  if (!nativeGeminiHistorySelected()) return undefined;
  try {
    assertNativeGeminiHistoryCurrent();
    const project = path.resolve(projectRoot);
    if (fs.realpathSync(project) !== project || within(configuration, authority.selected) || within(authority.selected, configuration)) throw refuse();
    const identifier = digest(project);
    const parent = directory([]);
    locked(parent, current => {
      const location = { target: `${parent.anchor}/projects.json` };
      const saved = snapshot(location, true);
      const registry = saved === null ? { projects: {} } : JSON.parse(saved);
      if (!registry || typeof registry !== 'object' || Array.isArray(registry) || !registry.projects || typeof registry.projects !== 'object' || Array.isArray(registry.projects)) throw refuse();
      for (const [name, value] of Object.entries(registry.projects)) {
        if (!path.isAbsolute(name) || !/^[a-f0-9]{64}$/u.test(value)) throw refuse();
      }
      if (registry.projects[project] !== undefined && registry.projects[project] !== identifier) throw refuse();
      if (registry.projects[project] === undefined) {
        registry.projects[project] = identifier;
        publish(parent, 'projects.json', JSON.stringify(registry), current);
      }
    });
    const chats = directory(['projects', identifier, 'chats']);
    conversations.set(chats.anchor, chats);
    return chats.anchor;
  } catch {
    throw refuse();
  }
}

function conversationLocation(file) {
  assertNativeGeminiHistoryCurrent();
  for (const [anchor, item] of conversations) {
    const named = path.join(authority.selected, ...item.components);
    const prefix = [anchor, named].find(parent => typeof file === 'string' && file.startsWith(parent + '/'));
    if (!prefix) continue;
    const components = file.slice(prefix.length + 1).split('/');
    if (components.some(name => !/^[a-zA-Z0-9_.-]{1,200}$/u.test(name) || ['.', '..'].includes(name))) throw refuse();
    const name = components.pop();
    if (!/\.jsonl?$/u.test(name)) throw refuse();
    const parent = directory([...item.components, ...components]);
    return { parent, name, target: `${parent.anchor}/${name}`, key: `${named}/${components.concat(name).join('/')}` };
  }
  throw refuse();
}

export function readNativeGeminiConversation(file) {
  if (!nativeGeminiHistorySelected()) return undefined;
  try {
    const location = conversationLocation(file);
    return locked(location.parent, () => {
      const content = snapshot(location, true);
      observed.set(location.key, content === null ? null : digest(content));
      return content;
    });
  } catch {
    throw refuse();
  }
}

export function appendNativeGeminiConversation(file, line) {
  if (!nativeGeminiHistorySelected()) return false;
  try {
    const location = conversationLocation(file);
    const bytes = Buffer.from(line);
    if (bytes.length > LIMIT) throw refuse();
    locked(location.parent, current => {
      const before = checkedFile(location, true);
      const fd = fs.openSync(location.target, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600);
      try {
        const opened = fs.fstatSync(fd, { bigint: true });
        if (!safeFile(opened) || opened.size + BigInt(bytes.length) > BigInt(LIMIT) || (before && identity(before) !== identity(opened)) || identity(checkedFile(location)) !== identity(opened)) throw refuse();
        current();
        if (fs.writeSync(fd, bytes) !== bytes.length) throw refuse();
        fs.fsyncSync(fd);
        fs.fsyncSync(location.parent.fd);
        if (identity(checkedFile(location)) !== identity(opened)) throw refuse();
        current();
      } finally {
        fs.closeSync(fd);
      }
      observed.set(location.key, digest(snapshot(location)));
    });
    return true;
  } catch {
    throw refuse();
  }
}

export function rewriteNativeGeminiConversation(file, content) {
  if (!nativeGeminiHistorySelected()) return false;
  try {
    if (Buffer.byteLength(content) > LIMIT) throw refuse();
    const location = conversationLocation(file);
    locked(location.parent, current => {
      const previous = snapshot(location, true);
      const generation = previous === null ? null : digest(previous);
      if (generation !== (observed.get(location.key) ?? null)) throw refuse();
      if (previous !== null) publish(location.parent, `${location.name}.preserved-${randomUUID()}`, previous, current);
      publish(location.parent, location.name, content, current);
      observed.set(location.key, digest(content));
    });
    return true;
  } catch {
    throw refuse();
  }
}
