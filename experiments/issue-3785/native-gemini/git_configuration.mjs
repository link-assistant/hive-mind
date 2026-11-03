// Refuse changed executable Git configuration before the native Git child runs.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createHash } from 'node:crypto';

const bindings = new WeakMap();
const identity = info => `${info.dev}:${info.ino}`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function names(directory, refuse) {
  const result = [];
  const handle = fs.opendirSync(directory, { bufferSize: 16 });
  try {
    for (let entry; (entry = handle.readSync()) !== null;) {
      if (result.length >= 32) throw refuse();
      result.push(entry.name);
    }
  } finally {
    handle.closeSync();
  }
  return result;
}

export function assertNativeGeminiGitConfiguration(context, readFile, refuse, seal = false) {
  const previous = bindings.get(context);
  if (!previous && !seal) return;
  const observed = new Map();
  function directory(relative, allowed) {
    const named = path.join(context.privateRoot, relative);
    const info = fs.lstatSync(named, { bigint: true });
    if (!info.isDirectory() || info.uid !== BigInt(process.getuid()) || (info.mode & 0o022n) !== 0n || fs.realpathSync(named) !== named || (previous && previous.directories.get(relative) !== identity(info))) throw refuse();
    if (names(named, refuse).some(name => !allowed.includes(name))) throw refuse();
    observed.set(relative, identity(info));
  }
  directory('', ['.project_root', '.gitconfig', '.gitconfig_system_empty', '.gitignore', 'empty-template', '.git']);
  directory('empty-template', []);
  directory('.git', ['HEAD', 'config', 'refs', 'objects', 'index', 'COMMIT_EDITMSG']);
  directory('.git/refs', ['heads', 'tags']);
  directory('.git/refs/heads', ['main']);
  directory('.git/refs/tags', []);
  if (fs.existsSync(context.privateRoot + '/.git/objects')) {
    directory('.git/objects', ['info', 'pack']);
    directory('.git/objects/info', []);
    directory('.git/objects/pack', []);
  }
  const files = new Map();
  for (const relative of ['.project_root', '.gitconfig', '.gitconfig_system_empty', '.git/config', '.git/HEAD']) {
    const bytes = readFile(path.join(context.privateRoot, relative));
    const digest = hash(bytes);
    if (previous && previous.files.get(relative) !== digest) throw refuse();
    files.set(relative, digest);
  }
  if (readFile(context.privateRoot + '/.project_root').toString('utf8') !== context.project || readFile(context.privateRoot + '/.git/HEAD').toString('utf8') !== 'ref: refs/heads/main\n' || !/^[a-f0-9]{40}\n$/u.test(readFile(context.privateRoot + '/.git/refs/heads/main').toString('utf8'))) throw refuse();
  for (const relative of ['.git/index', '.git/COMMIT_EDITMSG', '.gitignore']) {
    const named = context.privateRoot + '/' + relative;
    if (!fs.existsSync(named)) continue;
    const info = fs.lstatSync(named, { bigint: true });
    if (!info.isFile() || info.uid !== BigInt(process.getuid()) || info.nlink !== 1n || (info.mode & 0o022n) !== 0n || info.size > 16n * 1024n * 1024n) throw refuse();
  }
  if (!previous) bindings.set(context, { directories: observed, files });
}
