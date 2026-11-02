// Experimental native Git objects use data-only canonical storage. Native Git
// configuration, hooks, index and derived refs remain in disposable private state.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { AsyncLocalStorage } from 'node:async_hooks';
import { withSharedAuthRefreshLock } from './hive-gemini-git-lock.mjs';
import { nativeGeminiHistorySelected, assertNativeGeminiHistoryCurrent, readNativeGeminiPromptHistory, appendNativeGeminiPromptHistory } from './hive-gemini-history.mjs';

const operations = new AsyncLocalStorage();
const services = new WeakMap();
const directories = new Map();
const sessionId = 'hive-native-git-checkpoints';
const id = info => `${info.dev}:${info.ino}`;
const version = info => `${id(info)}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${info.mode}:${info.nlink}`;
const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const safeDirectory = info => info.isDirectory() && info.uid === BigInt(process.getuid()) && (info.mode & 0o077n) === 0n;
let failed = false;
const refuse = () => {
  if (!failed && process.env.GEMINI_HISTORY_DEBUG === '1') {
    const locations = new Error().stack?.match(/git[-_]history\.mjs:[0-9]+:[0-9]+/gu) ?? [];
    process.stderr.write(`Gemini Git history refused at ${locations.slice(0, 8).join(', ')}.\n`);
  }
  failed = true;
  return new Error('Gemini canonical conversation history is unavailable or unsafe.');
};

function directory(named) {
  assertNativeGeminiHistoryCurrent();
  const previous = directories.get(named);
  const before = fs.lstatSync(named, { bigint: true });
  if (!safeDirectory(before) || fs.realpathSync(named) !== named || (previous && id(before) !== previous.identity)) throw refuse();
  if (previous) return previous;
  if (directories.size >= 1024) throw refuse();
  const fd = fs.openSync(named, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  const opened = fs.fstatSync(fd, { bigint: true });
  if (!safeDirectory(opened) || id(opened) !== id(before)) {
    fs.closeSync(fd);
    throw refuse();
  }
  const result = { fd, named, identity: id(opened), anchor: `/proc/self/fd/${fd}` };
  directories.set(named, result);
  return result;
}

function child(parent, name) {
  const target = parent.anchor + '/' + name;
  try {
    fs.mkdirSync(target, { mode: 0o700 });
    fs.fsyncSync(parent.fd);
  } catch (error) {
    if (error.code !== 'EEXIST') throw refuse();
  }
  const info = fs.lstatSync(target, { bigint: true });
  const result = directory(path.join(parent.named, name));
  if (!safeDirectory(info) || id(info) !== result.identity) throw refuse();
  return result;
}

function current(context) {
  if (failed || process.platform !== 'linux') throw refuse();
  assertNativeGeminiHistoryCurrent();
  if (context.service.projectRoot !== context.project || context.service.storage !== context.storage || context.storage.getProjectTempDir() !== context.temporary || context.storage.getHistoryDir() !== context.privateRoot || process.env.GEMINI_HISTORY_HOME !== context.root) throw refuse();
  for (const item of directories.values()) {
    const named = fs.lstatSync(item.named, { bigint: true });
    const opened = fs.fstatSync(item.fd, { bigint: true });
    if (!safeDirectory(named) || !safeDirectory(opened) || id(named) !== item.identity || id(opened) !== item.identity || fs.realpathSync(item.named) !== item.named) throw refuse();
  }
}

function privateFile(file) {
  const before = fs.lstatSync(file, { bigint: true });
  if (!before.isFile() || before.uid !== BigInt(process.getuid()) || before.nlink !== 1n || (before.mode & 0o022n) !== 0n || before.size > 65536n) throw refuse();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    if (version(fs.fstatSync(fd, { bigint: true })) !== version(before)) throw refuse();
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, length);
      if (!count) break;
      length += count;
    }
    if (BigInt(length) !== before.size || version(fs.fstatSync(fd, { bigint: true })) !== version(before) || version(fs.lstatSync(file, { bigint: true })) !== version(before)) throw refuse();
    return bytes.subarray(0, length);
  } finally {
    fs.closeSync(fd);
  }
}

function binding(service) {
  let context = services.get(service);
  if (context) {
    current(context);
    return context;
  }
  const project = service.projectRoot;
  const storage = service.storage;
  if (typeof project !== 'string' || !path.isAbsolute(project) || fs.realpathSync(project) !== project) throw refuse();
  const temporary = storage.getProjectTempDir();
  readNativeGeminiPromptHistory(temporary);
  const root = process.env.GEMINI_HISTORY_HOME;
  const canonical = directory(root);
  const projects = directory(path.join(canonical.named, 'projects'));
  const projectDirectory = directory(path.join(projects.named, hash(project)));
  const store = child(projectDirectory, 'git-checkpoints');
  const objects = child(store, 'objects');
  child(objects, 'info');
  child(objects, 'pack');
  // Git's default umask can create 0755 fanout directories. Precreate data
  // directories privately rather than changing process-wide configuration.
  for (let value = 0; value < 256; value++) child(objects, value.toString(16).padStart(2, '0'));
  const privateRoot = storage.getHistoryDir();
  if (privateRoot === root || privateRoot.startsWith(root + path.sep) || root.startsWith(privateRoot + path.sep)) throw refuse();
  if (fs.existsSync(privateRoot)) {
    const info = fs.lstatSync(privateRoot, { bigint: true });
    if (!info.isDirectory() || info.uid !== BigInt(process.getuid()) || (info.mode & 0o022n) !== 0n || fs.realpathSync(privateRoot) !== privateRoot || fs.readdirSync(privateRoot).some(name => name !== '.project_root') || privateFile(privateRoot + '/.project_root').toString('utf8') !== project) throw refuse();
  }
  context = { service, project, storage, temporary, root, store, objects, privateRoot, initialized: false };
  services.set(service, context);
  current(context);
  return context;
}

function heads(records) {
  const result = [];
  for (const record of records) {
    if (record.type !== 'git-checkpoint') continue;
    if (record.sessionId !== sessionId || !/^[a-f0-9]{40}$/u.test(record.message)) throw refuse();
    result.push(record.message);
  }
  return result;
}

function inspectObjects(context, synchronize = false) {
  current(context);
  let files = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(context.objects.anchor, { withFileTypes: true })) {
    if (!['info', 'pack'].includes(entry.name) && !/^[a-f0-9]{2}$/u.test(entry.name)) throw refuse();
    const parent = directory(path.join(context.objects.named, entry.name));
    const names = fs.readdirSync(parent.anchor);
    if (['info', 'pack'].includes(entry.name)) {
      if (names.length) throw refuse();
      continue;
    }
    for (const name of names) {
      if (!/^[a-f0-9]{38}$/u.test(name) || ++files > 10000) throw refuse();
      const target = parent.anchor + '/' + name;
      const before = fs.lstatSync(target, { bigint: true });
      if (!before.isFile() || before.uid !== BigInt(process.getuid()) || before.nlink !== 1n || (before.mode & 0o022n) !== 0n || before.size > 32n * 1024n * 1024n) throw refuse();
      bytes += Number(before.size);
      if (bytes > 128 * 1024 * 1024) throw refuse();
      const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      try {
        if (version(fs.fstatSync(fd, { bigint: true })) !== version(before)) throw refuse();
        const buffer = Buffer.alloc(Number(before.size) + 1);
        let length = 0;
        while (length < buffer.length) {
          const count = fs.readSync(fd, buffer, length, buffer.length - length, length);
          if (!count) break;
          length += count;
        }
        if (BigInt(length) !== before.size || hash(inflateSync(buffer.subarray(0, length), { maxOutputLength: 32 * 1024 * 1024 }), 'sha1') !== entry.name + name) throw refuse();
        if (version(fs.fstatSync(fd, { bigint: true })) !== version(before) || version(fs.lstatSync(target, { bigint: true })) !== version(before)) throw refuse();
        if (synchronize) fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    }
    if (synchronize) fs.fsyncSync(parent.fd);
  }
  if (synchronize) fs.fsyncSync(context.objects.fd);
  current(context);
  return files;
}

export function assertNativeGeminiGitOperation(service) {
  if (!nativeGeminiHistorySelected()) return;
  const context = operations.getStore();
  if (!context || context.service !== service) throw refuse();
  current(context);
}

export function nativeGeminiGitEnvironment(service, env) {
  if (!nativeGeminiHistorySelected()) return env;
  assertNativeGeminiGitOperation(service);
  const context = operations.getStore();
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('GIT_')));
  const config = { 'credential.helper': '', 'core.fsmonitor': '', 'core.hooksPath': '', 'core.sshCommand': '', 'core.pager': 'cat', 'core.editor': '', 'sequence.editor': '', 'gc.auto': '0', 'maintenance.auto': 'false', 'core.commitGraph': 'false' };
  const pairs = Object.entries(config).flatMap(([key, value], index) => [
    [`GIT_CONFIG_KEY_${index}`, key],
    [`GIT_CONFIG_VALUE_${index}`, value],
  ]);
  return { ...clean, ...Object.fromEntries(pairs), GIT_CONFIG_COUNT: String(Object.keys(config).length), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: env.GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM: env.GIT_CONFIG_SYSTEM, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Gemini CLI', GIT_AUTHOR_EMAIL: 'gemini-cli@google.com', GIT_COMMITTER_NAME: 'Gemini CLI', GIT_COMMITTER_EMAIL: 'gemini-cli@google.com', GIT_TEMPLATE_DIR: context.privateRoot + '/empty-template', GIT_OBJECT_DIRECTORY: `/proc/${process.pid}/fd/${context.objects.fd}` };
}

export async function withNativeGeminiGitHistory(service, method, action) {
  if (!nativeGeminiHistorySelected()) return action();
  try {
    const existing = operations.getStore();
    if (existing?.service === service) {
      current(existing);
      return await action();
    }
    if (method === 'initialize') await service.storage.initialize();
    const context = binding(service);
    if (method !== 'initialize' && !context.initialized) throw refuse();
    return await withSharedAuthRefreshLock({ directory: context.store.named, lockName: '.native-git.lock', waitMs: 5000 }, async ({ assertCurrent }) =>
      operations.run(context, async () => {
        current(context);
        const previous = heads(readNativeGeminiPromptHistory(context.temporary));
        const head = previous.at(-1);
        const count = inspectObjects(context);
        if (!head && count) throw refuse();
        if (method === 'initialize') {
          fs.mkdirSync(context.privateRoot, { recursive: true, mode: 0o700 });
          fs.mkdirSync(context.privateRoot + '/empty-template', { recursive: true, mode: 0o700 });
        } else if (head) {
          await service.shadowGitRepository.raw('update-ref', 'HEAD', head);
          await service.shadowGitRepository.raw('read-tree', head);
        }
        const result = await action();
        if (method === 'initialize' && head) {
          await service.shadowGitRepository.raw('update-ref', 'HEAD', head);
          await service.shadowGitRepository.raw('read-tree', head);
        }
        const actual = await service.getCurrentCommitHash();
        if (!/^[a-f0-9]{40}$/u.test(actual) || (!['initialize', 'createFileSnapshot'].includes(method) && actual !== head)) throw refuse();
        inspectObjects(context, true);
        await assertCurrent();
        if (actual !== head)
          appendNativeGeminiPromptHistory(context.temporary, { sessionId, messageId: 0, type: 'git-checkpoint', message: actual, timestamp: new Date().toISOString() }, records => {
            if (heads(records).at(-1) !== head) throw refuse();
            current(context);
          });
        context.initialized = true;
        current(context);
        return result;
      })
    );
  } catch (error) {
    if (!failed && process.env.GEMINI_HISTORY_DEBUG === '1') {
      const locations = error?.stack?.match(/(?:git[-_]history\.mjs|chunk-DKZARV6U\.js):[0-9]+:[0-9]+/gu) ?? [];
      process.stderr.write(`Gemini Git operation failed at ${locations.slice(0, 8).join(', ')}.\n`);
    }
    throw refuse();
  }
}
