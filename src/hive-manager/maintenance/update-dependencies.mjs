import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, rmdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { sanitizeCredentialText } from '../../credential-sanitization-core.lib.mjs';

const run = promisify(execFile);
const files = ['package.json', 'bun.lock', 'bun.lockb'];
const packageName = /^(?:@[a-z\d][\w.-]*\/)?[a-z\d][\w.-]*$/i;
const usage = `Usage: hive-manager deploy [OPTIONS] update-dependencies [--apply | --dry-run] PACKAGE... | --all
Preview updates to Bun global dependencies for the deployment's box user.
Supply --apply to back up the manifest and lockfiles and run the update.
Writes a JSON receipt to stdout, including on a Bun failure.
`;

async function readFile(file, optional = false) {
  let fd;
  try {
    fd = await open(file, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    const info = await fd.stat();
    if (!info.isFile() || info.size > 16 * 1024 * 1024) throw new Error('Unsafe Bun global manifest or lockfile.');
    const data = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await fd.read(data, offset, data.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== info.size || (await fd.stat()).mtimeMs !== info.mtimeMs) throw new Error('Bun global file changed during inspection.');
    return data.subarray(0, offset);
  } catch (error) {
    if (optional && error.code === 'ENOENT') return null;
    throw error;
  } finally {
    await fd?.close();
  }
}

async function manifest(dir) {
  const bytes = await readFile(join(dir, 'package.json'));
  const data = JSON.parse(bytes);
  const dependencies = data?.dependencies;
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies) || Object.entries(dependencies).some(([name, spec]) => !packageName.test(name) || typeof spec !== 'string')) {
    throw new Error('Expected a Bun global package.json with top-level dependencies.');
  }
  return { bytes, dependencies };
}

async function versions(dir, dependencies, names) {
  const entries = [];
  for (const name of names) {
    const bytes = await readFile(join(dir, 'node_modules', name, 'package.json'), true);
    entries.push([name, { declared: dependencies[name] ?? null, installed: bytes ? (JSON.parse(bytes).version ?? null) : null }]);
  }
  return Object.fromEntries(entries);
}

async function rollbackFiles(dir, manifestBytes) {
  return [manifestBytes, await readFile(join(dir, files[1]), true), await readFile(join(dir, files[2]), true)];
}

function checksums(buffers) {
  return Object.fromEntries(files.map((file, index) => [file, buffers[index] ? createHash('sha256').update(buffers[index]).digest('hex') : null]));
}

async function update(dir, backupRoot, names, all, apply) {
  const initial = await manifest(dir);
  const declared = Object.keys(initial.dependencies).sort();
  const selected = all ? declared : names;
  if (!selected.length || selected.some(name => !Object.hasOwn(initial.dependencies, name))) {
    throw new Error('Select at least one installed top-level Bun global dependency.');
  }
  const before = await versions(dir, initial.dependencies, declared);
  const originals = await rollbackFiles(dir, initial.bytes);
  let backup = null;
  if (apply) {
    backup = await mkdtemp(join(backupRoot, 'update-'));
    for (const [index, file] of files.entries()) {
      if (originals[index]) await writeFile(join(backup, file), originals[index], { flag: 'wx', mode: 0o600, flush: true });
    }
  }

  const args = ['update', '--global', '--latest', ...(apply ? [] : ['--dry-run', '--ignore-scripts']), ...(all ? [] : selected)];
  const receipt = {
    dryRun: !apply,
    all,
    selected,
    command: ['bun', ...args],
    backup,
    before,
    after: null,
    changed: [],
    checksums: { before: checksums(originals), after: null },
    exitCode: 0,
    output: '',
    error: null,
  };
  try {
    const result = await run('bun', args, {
      cwd: homedir(),
      env: { ...process.env, BUN_INSTALL_GLOBAL_DIR: dir, CI: '1', NO_COLOR: '1' },
      timeout: 30 * 60 * 1000,
      maxBuffer: 1024 * 1024,
    }).catch(error => error);
    receipt.exitCode = result.code ?? 0;
    if (typeof receipt.exitCode !== 'number') receipt.exitCode = 1;
    receipt.error = result instanceof Error ? (result.killed ? 'Bun exceeded the time or output limit.' : 'Bun update failed.') : null;
    receipt.output = sanitizeCredentialText([result.stdout, result.stderr].filter(Boolean).join('\n'));
    const current = await manifest(dir);
    receipt.checksums.after = checksums(await rollbackFiles(dir, current.bytes));
    const observed = [...new Set([...declared, ...Object.keys(current.dependencies)])].sort();
    receipt.after = await versions(dir, current.dependencies, observed);
    receipt.changed = observed.filter(name => JSON.stringify(before[name]) !== JSON.stringify(receipt.after[name]));
    if (receipt.changed.some(name => !apply || (!all && !selected.includes(name)))) {
      receipt.error = apply ? 'Bun changed an unselected top-level dependency. Review the rollback files.' : 'Bun changed a top-level dependency during preview.';
    }
    if (!apply && JSON.stringify(receipt.checksums.before) !== JSON.stringify(receipt.checksums.after)) {
      receipt.error = 'The Bun global manifest or lockfile changed during preview.';
    }
  } catch {
    receipt.error = 'Could not verify dependency versions after Bun exited.';
  }
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  if (receipt.error) process.exitCode = 1;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { help: { type: 'boolean', short: 'h' }, apply: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, all: { type: 'boolean' } },
  });
  if (values.help) {
    process.stdout.write(usage);
    return;
  }
  if ((values.apply && values['dry-run']) || Boolean(values.all) === Boolean(positionals.length) || positionals.some(name => !packageName.test(name))) {
    throw new Error('Use either --all or top-level package names, and at most one of --apply and --dry-run.');
  }
  const dir = process.env.BUN_INSTALL_GLOBAL_DIR || join(process.env.BUN_INSTALL || join(homedir(), '.bun'), 'install', 'global');
  if (!isAbsolute(dir) || !(await lstat(dir)).isDirectory()) throw new Error('Expected an absolute Bun global directory.');
  const backupRoot = join(homedir(), '.hive-mind', 'state', 'tool-maintenance', 'dependency-backups');
  const names = [...new Set(positionals)];
  if (!values.apply) {
    await update(dir, backupRoot, names, values.all ?? false, false);
    return;
  }
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  const lock = join(backupRoot, '.update-lock');
  await mkdir(lock, { mode: 0o700 }).catch(error => {
    if (error.code === 'EEXIST') throw new Error('A Bun global update is already active. Check the update lock before retrying.');
    throw error;
  });
  try {
    await update(dir, backupRoot, names, values.all ?? false, true);
  } finally {
    await rmdir(lock);
  }
}

main().catch(error => {
  process.stderr.write(`${error instanceof SyntaxError ? 'Invalid Bun global JSON.' : error.message}\n`);
  process.exitCode = 1;
});
