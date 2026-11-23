import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { executionId } from '../../storage/lib/docker.mjs';
import { run } from '../../storage/lib/process.mjs';

export const receiptRoot = '/var/lib/hive-manager/auto-fix';

export function receiptDirectory(root, name, create = false) {
  const directory = join(root, name);
  for (const path of [root, directory]) {
    if (create) mkdirSync(path, { recursive: true, mode: 0o700 });
    try {
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.uid !== process.getuid() || stat.mode & 0o077 || realpathSync(path) !== path) throw new Error('Auto-fix requires private, operator-owned receipt directories.');
    } catch (error) {
      if (!create && error.code === 'ENOENT') return directory;
      throw error;
    }
  }
  return directory;
}

function read(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function save(path, value) {
  const temporary = `${path}.${process.pid}.new`;
  const fd = openSync(temporary, 'w', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value) + '\n');
    fsyncSync(fd);
    renameSync(temporary, path);
    const folder = openSync(dirname(path), 'r');
    try {
      fsyncSync(folder);
    } finally {
      closeSync(folder);
    }
  } finally {
    closeSync(fd);
  }
}

export function receiptFile(directory, id) {
  if (typeof id !== 'string' || !executionId.test(id)) throw new Error('Supply a complete auto-fix run UUID.');
  return join(directory, `${id.toLowerCase()}.json`);
}

export function saveReceipt(directory, receipt, first = false) {
  save(receiptFile(directory, receipt.id), receipt);
  if (first) save(join(directory, 'latest.json'), receipt.id);
}

export function loadReceipt(directory, id) {
  const key = id ?? read(join(directory, 'latest.json'));
  return key === null ? null : read(receiptFile(directory, key));
}

export async function receiptStatus(directory, id) {
  const state = loadReceipt(directory, id);
  if (state?.status !== 'running') return state;
  // Read after probing the lock to avoid returning interrupted for a worker
  // that finalized its receipt between the first read and the probe.
  if (loadReceipt(directory)?.id === state.id) {
    const probe = await run('flock', ['-n', '-E', '75', join(directory, 'lock'), 'true']);
    if (probe.code === 75 && loadReceipt(directory)?.id === state.id) return loadReceipt(directory, state.id);
    if (![0, 75].includes(probe.code)) throw new Error('Could not check the auto-fix lock.');
  }
  const latest = loadReceipt(directory, state.id);
  if (latest.status === 'running') return { ...latest, status: 'interrupted' };
  return latest;
}
