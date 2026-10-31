// Disposable pinned native experiment. Configuration and executable material
// stay private; only native conversation records use this selected authority.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Buffer, isUtf8 } from 'node:buffer';
import { recoverNativeGeminiPublications, publishNativeGeminiExclusive } from './hive-gemini-publication.mjs';

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
const writerLeases = new Map();
const retiredConversations = new Set();
const importSources = new Map();
const projectTemps = new Map();
const archiveName = /^session-archive-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}-(session-[a-zA-Z0-9_.-]+\.jsonl?)$/u;
let authority;
let failed = false;

function refuse() {
  if (!failed && process.env.GEMINI_HISTORY_DEBUG === '1') {
    const locations = new Error().stack?.match(/history\.mjs:[0-9]+:[0-9]+/gu) ?? [];
    process.stderr.write(`Gemini history refused at ${locations.slice(0, 8).join(', ')}.\n`);
  }
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
    for (const lease of writerLeases.values()) {
      const named = fs.lstatSync(lease.target, { bigint: true });
      const opened = fs.fstatSync(lease.fd, { bigint: true });
      if (!safeFile(named) || !safeFile(opened) || named.size !== 0n || opened.size !== 0n || identity(named) !== lease.identity || identity(opened) !== lease.identity) throw refuse();
    }
  } catch {
    throw refuse();
  }
}

function directory(components, create = true) {
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
      if (create) {
        try {
          fs.mkdirSync(anchored, { mode: 0o700 });
          fs.fsyncSync(parent);
        } catch (error) {
          if (error.code !== 'EEXIST') throw refuse();
        }
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

function snapshot(location, missing = false, binary = false) {
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
    const content = bytes.subarray(0, length);
    if (binary) return content;
    if (!isUtf8(content)) throw refuse();
    return content.toString('utf8');
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
    recoverNativeGeminiPublications(parent, current, refuse);
    const value = operation(current);
    current();
    return value;
  } finally {
    fs.closeSync(fd);
  }
}

function publish(parent, name, content, current, replace = true, admit = () => {}) {
  const temporary = `${parent.anchor}/.history-${randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, content);
    fs.fsyncSync(fd);
    current();
    admit();
    if (replace) fs.renameSync(temporary, `${parent.anchor}/${name}`);
    else {
      publishNativeGeminiExclusive(parent, name, temporary, content, current, refuse);
    }
    fs.fsyncSync(parent.fd);
    current();
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
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
        publish(parent, 'projects.json', JSON.stringify(registry), current, saved !== null);
      }
    });
    const chats = directory(['projects', identifier, 'chats']);
    conversations.set(chats.anchor, chats);
    return chats.anchor;
  } catch {
    throw refuse();
  }
}

export function registerNativeGeminiProjectTemp(configuration, projectRoot, temporary) {
  if (!nativeGeminiHistorySelected()) return;
  try {
    assertNativeGeminiHistoryCurrent();
    const project = path.resolve(projectRoot);
    if (typeof temporary !== 'string' || !path.isAbsolute(temporary) || path.normalize(temporary) !== temporary || /[\0\r\n]/u.test(temporary)) throw refuse();
    const previous = projectTemps.get(temporary);
    if (previous) {
      if (previous.project !== project || previous.configuration !== configuration) throw refuse();
      return;
    }
    if (projectTemps.size >= 64) throw refuse();
    nativeGeminiChatsDirectory(configuration, project);
    projectTemps.set(temporary, { project, configuration, identifier: digest(project) });
  } catch {
    throw refuse();
  }
}

export function writeNativeGeminiToolOutput(temporary, content, sessionId) {
  if (!nativeGeminiHistorySelected()) return undefined;
  try {
    assertNativeGeminiHistoryCurrent();
    const project = projectTemps.get(temporary);
    if (!project || typeof content !== 'string' || Buffer.byteLength(content) > LIMIT || (sessionId !== undefined && typeof sessionId !== 'string')) throw refuse();
    const components = ['projects', project.identifier, 'tool-outputs', `session-${digest(sessionId ?? '')}`];
    const parent = directory(components);
    const name = `artifact-${digest(content)}-${randomUUID()}.txt`;
    locked(parent, current => publish(parent, name, content, current, false));
    return path.join(authority.selected, ...components, name);
  } catch {
    throw refuse();
  }
}

export function readNativeGeminiToolOutput(file) {
  if (!nativeGeminiHistorySelected()) return undefined;
  try {
    assertNativeGeminiHistoryCurrent();
    if (typeof file !== 'string' || !path.isAbsolute(file) || !within(authority.selected, path.resolve(file))) return undefined;
    const components = path.relative(authority.selected, file).split(path.sep);
    if (components[0] !== 'projects' || components[2] !== 'tool-outputs') return undefined;
    const filename = /^artifact-([a-f0-9]{64})-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.txt$/u.exec(components[4] ?? '');
    if (path.normalize(file) !== file || /[\0\r\n]/u.test(file) || components.length !== 5 || ![...projectTemps.values()].some(item => item.identifier === components[1]) || !/^session-[a-f0-9]{64}$/u.test(components[3]) || !filename) throw refuse();
    const name = components.pop();
    const parent = directory(components, false);
    return locked(parent, () => {
      const content = snapshot({ target: `${parent.anchor}/${name}` });
      if (digest(content) !== filename[1]) throw refuse();
      return content;
    });
  } catch {
    throw refuse();
  }
}

const validBlobMime = value => typeof value === 'string' && value.length <= 96 && /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/u.test(value);

export function writeNativeGeminiBlob(temporary, data, mimeType, sessionId) {
  if (!nativeGeminiHistorySelected()) return undefined;
  try {
    assertNativeGeminiHistoryCurrent();
    const project = projectTemps.get(temporary);
    if (!project || typeof data !== 'string' || data.length > Math.ceil(LIMIT / 3) * 4 || !validBlobMime(mimeType) || (sessionId !== undefined && typeof sessionId !== 'string')) throw refuse();
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > LIMIT || !/^[A-Za-z0-9+/]*={0,2}$/u.test(data)) throw refuse();
    const encoded = bytes.toString('base64');
    if (data !== encoded && data !== encoded.replace(/=+$/u, '')) throw refuse();
    const components = ['projects', project.identifier, 'degraded-blobs', `session-${digest(sessionId ?? '')}`];
    const parent = directory(components);
    const encodedType = Buffer.from(mimeType).toString('base64url');
    const name = `blob-${digest(bytes)}-${randomUUID()}.${encodedType}`;
    locked(parent, current => publish(parent, name, bytes, current, false));
    return path.join(authority.selected, ...components, name);
  } catch {
    throw refuse();
  }
}

export function readNativeGeminiBlob(file) {
  if (!nativeGeminiHistorySelected()) return undefined;
  try {
    assertNativeGeminiHistoryCurrent();
    if (typeof file !== 'string' || !path.isAbsolute(file) || !within(authority.selected, path.resolve(file))) return undefined;
    const components = path.relative(authority.selected, file).split(path.sep);
    if (components[0] !== 'projects' || components[2] !== 'degraded-blobs') return undefined;
    const filename = /^blob-([a-f0-9]{64})-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.([A-Za-z0-9_-]{3,128})$/u.exec(components[4] ?? '');
    if (path.normalize(file) !== file || /[\0\r\n]/u.test(file) || components.length !== 5 || ![...projectTemps.values()].some(item => item.identifier === components[1]) || !/^session-[a-f0-9]{64}$/u.test(components[3]) || !filename) throw refuse();
    const mimeType = Buffer.from(filename[2], 'base64url').toString('utf8');
    if (!validBlobMime(mimeType) || Buffer.from(mimeType).toString('base64url') !== filename[2]) throw refuse();
    const name = components.pop();
    const parent = directory(components, false);
    return locked(parent, () => {
      const bytes = snapshot({ target: `${parent.anchor}/${name}` }, false, true);
      if (digest(bytes) !== filename[1]) throw refuse();
      return { bytes, mimeType };
    });
  } catch {
    throw refuse();
  }
}

function loggerTransaction(temporary, family, validate, operation) {
  try {
    assertNativeGeminiHistoryCurrent();
    const project = projectTemps.get(temporary);
    if (!project) throw refuse();
    const parent = directory(['projects', project.identifier, 'message-history']);
    const name = `${family}-history.json`;
    const key = `${project.identifier}/${name}`;
    return locked(parent, current => {
      const location = { target: `${parent.anchor}/${name}` };
      const before = checkedFile(location, true);
      const generation = before === null ? null : version(before);
      const unchanged = () => {
        const named = checkedFile(location, true);
        if ((named === null ? null : version(named)) !== generation) throw refuse();
      };
      const previous = snapshot(location, true);
      unchanged();
      if (previous === null && observed.get(key)) throw refuse();
      const records = previous === null ? [] : JSON.parse(previous);
      if (!Array.isArray(records) || records.length > 100000) throw refuse();
      validate(records);
      const result = operation(records);
      if (result.changed) {
        validate(records);
        const content = JSON.stringify(records);
        if (records.length > 100000 || Buffer.byteLength(content) > LIMIT) throw refuse();
        validate(JSON.parse(content));
        publish(parent, name, content, current, previous !== null, unchanged);
        observed.set(key, digest(content));
      } else {
        observed.set(key, previous === null ? null : digest(previous));
      }
      return result.value;
    });
  } catch {
    throw refuse();
  }
}

function validatePromptHistory(records) {
  const messages = new Map();
  for (const entry of records) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).length !== 5 || typeof entry.sessionId !== 'string' || entry.sessionId.length > 4096 || !Number.isSafeInteger(entry.messageId) || entry.messageId < 0 || typeof entry.type !== 'string' || entry.type.length > 64 || typeof entry.message !== 'string' || typeof entry.timestamp !== 'string' || entry.timestamp.length > 64 || !Number.isFinite(Date.parse(entry.timestamp))) throw refuse();
    const previous = messages.get(entry.sessionId) ?? -1;
    if (entry.messageId <= previous) throw refuse();
    messages.set(entry.sessionId, entry.messageId);
  }
}

export function readNativeGeminiPromptHistory(temporary) {
  if (!nativeGeminiHistorySelected()) return undefined;
  return loggerTransaction(temporary, 'prompt', validatePromptHistory, records => ({ value: records }));
}

export function appendNativeGeminiPromptHistory(temporary, entry, validateAdditional = () => {}) {
  if (!nativeGeminiHistorySelected()) return undefined;
  return loggerTransaction(temporary, 'prompt', validatePromptHistory, records => {
    validateAdditional(records);
    let next = 0;
    for (const previous of records) {
      if (previous.sessionId === entry.sessionId) next = previous.messageId + 1;
    }
    const writtenEntry = { ...entry, messageId: next };
    records.push(writtenEntry);
    return { changed: true, value: { logs: records, writtenEntry } };
  });
}

function validCheckpointTag(tag) {
  return typeof tag === 'string' && tag.length > 0 && Buffer.byteLength(tag) <= 1024 && !/[\0\r\n]/u.test(tag) && Buffer.from(tag).toString('utf8') === tag;
}

function validCheckpoint(checkpoint) {
  return Array.isArray(checkpoint) || (checkpoint !== null && typeof checkpoint === 'object' && Array.isArray(checkpoint.history));
}

function validateCheckpointHistory(records) {
  for (const entry of records) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !validCheckpointTag(entry.tag) || typeof entry.timestamp !== 'string' || entry.timestamp.length > 64 || !Number.isFinite(Date.parse(entry.timestamp)) || !['save', 'delete'].includes(entry.operation) || Object.keys(entry).length !== (entry.operation === 'save' ? 4 : 3) || (entry.operation === 'save' && !validCheckpoint(entry.checkpoint))) throw refuse();
  }
}

export function nativeGeminiCheckpoint(temporary, tag, operation = 'read', checkpoint) {
  if (!nativeGeminiHistorySelected()) return undefined;
  if (!validCheckpointTag(tag) || !['read', 'save', 'delete'].includes(operation)) throw refuse();
  return loggerTransaction(temporary, 'checkpoint', validateCheckpointHistory, records => {
    const latest = records.findLast(entry => entry.tag === tag);
    const saved = latest?.operation === 'save' ? latest.checkpoint : undefined;
    if (operation === 'read') return { value: saved };
    if (operation === 'delete' && saved === undefined) return { value: false };
    if (operation === 'save' && !validCheckpoint(checkpoint)) throw refuse();
    const entry = { tag, operation, timestamp: new Date().toISOString() };
    if (operation === 'save') entry.checkpoint = checkpoint;
    records.push(entry);
    return { changed: true, value: true };
  });
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
    return { parent, name, target: `${parent.anchor}/${name}`, key: `${named}/${components.concat(name).join('/')}`, projectHash: item.components[1] };
  }
  throw refuse();
}

function validateRecords(content, name) {
  if (content === null) return;
  const records = name.endsWith('.jsonl') ? content.split('\n').filter(line => line.trim()) : [content];
  if (records.length === 0) throw refuse();
  for (const line of records) {
    const record = JSON.parse(line);
    if (record === null || typeof record !== 'object' || Array.isArray(record)) throw refuse();
  }
}

function acquireWriterLease(location) {
  assertNativeGeminiHistoryCurrent();
  const target = `${location.parent.anchor}/.writer-${digest(location.name)}.lock`;
  const fd = fs.openSync(target, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK, 0o600);
  let retained = false;
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    const named = fs.lstatSync(target, { bigint: true });
    if (!safeFile(opened) || !safeFile(named) || opened.size !== 0n || named.size !== 0n || identity(opened) !== identity(named)) throw refuse();
    const result = spawnSync('flock', ['-n', '-x', '3'], { env: { PATH: '/usr/bin:/bin' }, stdio: ['ignore', 'ignore', 'ignore', fd] });
    if (result.status === 1 && !result.error) return null;
    if (result.error || result.status !== 0 || identity(fs.lstatSync(target, { bigint: true })) !== identity(opened)) throw refuse();
    retained = true;
    return { fd, target, identity: identity(opened) };
  } finally {
    if (!retained) fs.closeSync(fd);
  }
}

export function claimNativeGeminiConversation(file) {
  if (!nativeGeminiHistorySelected()) return false;
  try {
    const location = conversationLocation(file);
    if (retiredConversations.has(location.key)) throw refuse();
    if (writerLeases.has(location.key)) return true;
    if (writerLeases.size >= 1024) throw refuse();
    const lease = acquireWriterLease(location);
    if (!lease) throw refuse();
    writerLeases.set(location.key, lease);
    assertNativeGeminiHistoryCurrent();
    return true;
  } catch {
    throw refuse();
  }
}

function importedLocation(file) {
  assertNativeGeminiHistoryCurrent();
  if (typeof file !== 'string' || /[\0\r\n]/u.test(file)) throw refuse();
  const absolute = path.resolve(file);
  let source = importSources.get(absolute);
  if (!source) {
    if (importSources.size >= 16) throw refuse();
    const parent = path.dirname(absolute);
    if (fs.realpathSync(parent) !== parent) throw refuse();
    const before = fs.lstatSync(parent, { bigint: true });
    if (!safeDirectory(before)) throw refuse();
    const fd = fs.openSync(parent, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!safeDirectory(opened) || identity(opened) !== identity(before)) {
      fs.closeSync(fd);
      throw refuse();
    }
    source = { fd, parent, identity: identity(opened), name: path.basename(absolute), target: `/proc/self/fd/${fd}/${path.basename(absolute)}`, key: absolute };
    importSources.set(absolute, source);
  }
  const named = fs.lstatSync(source.parent, { bigint: true });
  const opened = fs.fstatSync(source.fd, { bigint: true });
  if (!safeDirectory(named) || !safeDirectory(opened) || identity(named) !== source.identity || identity(opened) !== source.identity) throw refuse();
  return source;
}

export function admitNativeGeminiConversation(file, record, importing = false) {
  if (!nativeGeminiHistorySelected()) return record;
  let location;
  try {
    location = importing ? importedLocation(file) : conversationLocation(file);
    if (!record || typeof record !== 'object' || typeof record.sessionId !== 'string' || !/^[a-zA-Z0-9_-]+$/u.test(record.sessionId) || !Array.isArray(record.messages)) throw refuse();
    if (importing) {
      if (typeof record.projectHash !== 'string' || !/^[a-f0-9]{64}$/u.test(record.projectHash) || location.sourceVersion !== version(checkedFile(location)) || location.generation !== digest(snapshot(location)) || location.sourceVersion !== version(checkedFile(location))) throw refuse();
      importedLocation(file);
    } else if (record.projectHash !== location.projectHash) throw refuse();
    return record;
  } catch {
    throw refuse();
  } finally {
    if (importing && location) {
      importSources.delete(location.key);
      fs.closeSync(location.fd);
    }
  }
}

export function readNativeGeminiConversation(file, importing = false) {
  if (!nativeGeminiHistorySelected()) return undefined;
  try {
    if (importing) {
      const location = importedLocation(file);
      const before = checkedFile(location);
      const content = snapshot(location);
      validateRecords(content, location.name);
      importedLocation(file);
      if (version(before) !== version(checkedFile(location))) throw refuse();
      location.sourceVersion = version(before);
      location.generation = digest(content);
      return content;
    }
    const location = conversationLocation(file);
    return locked(location.parent, () => {
      const content = snapshot(location, true);
      validateRecords(content, location.name);
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
    if (retiredConversations.has(location.key)) throw refuse();
    const bytes = Buffer.from(line);
    if (bytes.length > LIMIT) throw refuse();
    validateRecords(line, location.name);
    locked(location.parent, current => {
      const previous = snapshot(location, true);
      validateRecords(previous, location.name);
      if (previous === null && observed.get(location.key)) throw refuse();
      const before = checkedFile(location, true);
      const fd = fs.openSync(location.target, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK | (before ? 0 : fs.constants.O_EXCL), 0o600);
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
    if (retiredConversations.has(location.key)) throw refuse();
    validateRecords(content, location.name);
    locked(location.parent, current => {
      const previous = snapshot(location, true);
      validateRecords(previous, location.name);
      const generation = previous === null ? null : digest(previous);
      if (generation !== (observed.get(location.key) ?? null)) throw refuse();
      if (previous !== null) publish(location.parent, `${location.name}.preserved-${randomUUID()}`, previous, current, false);
      publish(location.parent, location.name, content, current, previous !== null);
      observed.set(location.key, digest(content));
    });
    return true;
  } catch {
    throw refuse();
  }
}

export function archiveNativeGeminiConversation(file) {
  if (!nativeGeminiHistorySelected()) return false;
  try {
    const location = conversationLocation(file);
    const owned = writerLeases.has(location.key);
    if (!owned && writerLeases.size >= 1024) throw refuse();
    const lease = writerLeases.get(location.key) ?? acquireWriterLease(location);
    if (!lease) return 'busy';
    if (!owned) writerLeases.set(location.key, lease);
    let archived = false;
    try {
      locked(location.parent, current => {
        const previous = snapshot(location, true);
        if (previous === null) return;
        validateRecords(previous, location.name);
        if (!observed.has(location.key) || observed.get(location.key) !== digest(previous)) throw refuse();
        const before = checkedFile(location);
        const archive = directory([...location.parent.components, '.archive']);
        const name = `session-archive-${randomUUID()}-${location.name}`;
        if (name.length > 200) throw refuse();
        const destination = `${archive.anchor}/${name}`;
        current();
        fs.renameSync(location.target, destination);
        fs.fsyncSync(archive.fd);
        fs.fsyncSync(location.parent.fd);
        const retired = checkedFile({ target: destination });
        if (identity(retired) !== identity(before)) throw refuse();
        observed.set(location.key, null);
        current();
      });
      archived = true;
      retiredConversations.add(location.key);
      return true;
    } finally {
      if (!owned || archived) {
        writerLeases.delete(location.key);
        fs.closeSync(lease.fd);
      }
    }
  } catch {
    throw refuse();
  }
}

export function listNativeGeminiArchivedConversations(chatsDirectory) {
  if (!nativeGeminiHistorySelected()) return undefined;
  try {
    assertNativeGeminiHistoryCurrent();
    const chats = [...conversations.values()].find(item => chatsDirectory === item.anchor || chatsDirectory === path.join(authority.selected, ...item.components));
    if (!chats) throw refuse();
    const archive = directory([...chats.components, '.archive']);
    return locked(archive, current => {
      const entries = [];
      const handle = fs.opendirSync(archive.anchor, { bufferSize: 32 });
      try {
        let count = 0;
        for (let entry; (entry = handle.readSync()) !== null;) {
          if (++count > 1024) throw refuse();
          if (entry.name === '.history.lock') continue;
          if (entry.name.length > 200 || !archiveName.test(entry.name)) throw refuse();
          const target = `${archive.anchor}/${entry.name}`;
          const info = checkedFile({ target });
          entries.push({ target: `${chats.anchor}/.archive/${entry.name}`, modified: info.mtimeNs });
        }
      } finally {
        handle.closeSync();
      }
      current();
      return entries.sort((a, b) => (a.modified > b.modified ? -1 : a.modified < b.modified ? 1 : a.target.localeCompare(b.target))).map(entry => entry.target);
    });
  } catch {
    throw refuse();
  }
}

export function restoreNativeGeminiConversation(chatsDirectory, archivedFile, record) {
  if (!nativeGeminiHistorySelected()) return undefined;
  try {
    const source = conversationLocation(archivedFile);
    const name = archiveName.exec(source.name)?.[1];
    if (!name || source.parent.components.length !== 4 || source.parent.components[3] !== '.archive') throw refuse();
    admitNativeGeminiConversation(archivedFile, record);
    if (record.kind === 'subagent') throw refuse();
    const destination = conversationLocation(path.join(chatsDirectory, name));
    if (destination.projectHash !== source.projectHash || destination.parent.components.length !== 3) throw refuse();
    if (!writerLeases.has(destination.key)) {
      if (writerLeases.size >= 1024) throw refuse();
      const lease = acquireWriterLease(destination);
      if (!lease) throw refuse();
      writerLeases.set(destination.key, lease);
    }
    return locked(destination.parent, current =>
      locked(source.parent, archiveCurrent => {
        const content = snapshot(source);
        validateRecords(content, source.name);
        if (!observed.has(source.key) || observed.get(source.key) !== digest(content) || snapshot(destination, true) !== null) throw refuse();
        current();
        archiveCurrent();
        publish(destination.parent, destination.name, content, current, false);
        archiveCurrent();
        retiredConversations.delete(destination.key);
        observed.set(destination.key, digest(content));
        return destination.target;
      })
    );
  } catch {
    throw refuse();
  }
}
