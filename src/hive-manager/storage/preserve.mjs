import { createHash } from 'node:crypto';
import { closeSync, constants, createReadStream, fstatSync, lstatSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { absolute, dockerRoot, executionId, inspect, mountTable, overlaps, runtimeRoots, upperDirectory, within } from './lib/docker.mjs';
import { output, run } from './lib/process.mjs';
import { taskRecords } from './lib/records.mjs';

const schema = 'hive-manager-stopped-writable-layer-v1';
const evidenceFiles = ['layer.tar.gz', 'container.json', 'execution.json', 'task.log', 'docker.stdout.log', 'docker.stderr.log'];
const evidenceBudget = 30 * 60_000;

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, { flags: constants.O_RDONLY | constants.O_NOFOLLOW })) hash.update(chunk);
  return hash.digest('hex');
}

function stoppedFacts(row, execution) {
  const state = row.state;
  if (state.Status !== 'exited' || state.Running || state.Paused || !Number.isInteger(state.ExitCode) || state.ExitCode <= 0) {
    throw new Error('Preservation requires a stopped task with a nonzero exit code.');
  }
  if (!executionId.test(execution) || (row.execution && row.execution.toLowerCase() !== execution.toLowerCase())) {
    throw new Error('Supply the matching start-command execution UUID.');
  }
  return {
    id: row.id,
    name: row.name,
    execution: execution.toLowerCase(),
    image: row.image,
    driver: row.driver,
    logDriver: row.logDriver,
    startedAt: state.StartedAt,
    finishedAt: state.FinishedAt,
    exitCode: state.ExitCode,
    oomKilled: state.OOMKilled,
    mounts: row.mounts ?? [],
    tmpfs: row.tmpfs ?? {},
  };
}

function matchesRecord(record, facts) {
  const { options } = record;
  return record.uuid?.toLowerCase() === facts.execution && options?.isolated === 'docker' && ((record.status === 'executed' && record.exitCode === facts.exitCode && options?.containerId === facts.id && options?.sessionName === facts.name) || (Array.isArray(record.attemptHistory) && record.attemptHistory.some(attempt => attempt.containerId === facts.id && attempt.sessionName === facts.name && attempt.exitCode === facts.exitCode)));
}

async function captureTaskLog(docker, instance, facts, stage) {
  const { data: record, local } = await taskRecords(docker, instance, { execution: facts.execution }, { maxBytes: 4 * 1024 ** 2 });
  if (!matchesRecord(record, facts)) throw new Error('The stored start-command attempt differs from the stopped task.');
  if (!absolute(record.logPath)) throw new Error('The execution record has no usable task log path.');
  let source = record.logPath;
  if (!local) {
    const [bot] = await inspect(docker, [instance]);
    const mount = (bot.mounts ?? []).filter(entry => absolute(entry.Destination) && absolute(entry.Source) && within(record.logPath, entry.Destination)).sort((a, b) => b.Destination.length - a.Destination.length)[0];
    if (!mount) throw new Error('The task log is outside the deployment’s persisted mounts.');
    source = join(realpathSync(mount.Source), relative(mount.Destination, record.logPath));
  }
  if (realpathSync(source) !== source) throw new Error('The task log contains a symbolic link.');
  const fd = openSync(source, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile()) throw new Error('The start-command task log is not a regular file.');
    await copyFile(`/proc/self/fd/${fd}`, join(stage, 'task.log'), constants.COPYFILE_EXCL);
    const after = fstatSync(fd);
    if (before.size !== after.size || before.ctimeMs !== after.ctimeMs || lstatSync(source).ino !== before.ino) throw new Error('The task log changed during preservation.');
    writeFileSync(join(stage, 'execution.json'), JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
    return { uid: before.uid, gid: before.gid, mode: before.mode & 0o7777, bytes: before.size };
  } finally {
    closeSync(fd);
  }
}

async function captureDockerLogs(docker, id, stage) {
  const stdout = openSync(join(stage, 'docker.stdout.log'), 'wx', 0o600);
  const stderr = openSync(join(stage, 'docker.stderr.log'), 'wx', 0o600);
  try {
    await docker(['logs', '--timestamps', '--', id], { ms: evidenceBudget, stdio: ['ignore', stdout, stderr] });
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
}

function privateDir(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || stat.mode & 0o077) throw new Error('Use a private preservation directory owned by the operator.');
}

export async function preserveLayer(docker, instance, container, directory, execution) {
  const [row] = await inspect(docker, [container]);
  const facts = stoppedFacts(row, execution ?? row.execution);
  const root = realpathSync(await dockerRoot(docker));
  const upper = await upperDirectory(row, root);
  if (mountTable().some(mount => within(mount.path, upper))) throw new Error('The stopped writable layer contains a host mount.');
  const parent = realpathSync(dirname(resolve(directory)));
  const destination = join(parent, basename(resolve(directory)));
  if ([root, ...runtimeRoots].some(path => overlaps(path, destination))) throw new Error('Store the evidence outside Docker and containerd storage.');

  const stage = mkdtempSync(`${destination}.part-`);
  try {
    const taskLog = await captureTaskLog(docker, instance, facts, stage);
    await captureDockerLogs(docker, facts.id, stage);
    writeFileSync(join(stage, 'container.json'), JSON.stringify({ ...facts, upperDirectory: upper }, null, 2) + '\n', { mode: 0o600 });
    const archive = join(stage, 'layer.tar.gz');
    await output('tar', ['--numeric-owner', '--acls', '--xattrs', '--xattrs-include=*', '--selinux', '--one-file-system', '-czf', archive, '-C', upper, '.'], { ms: evidenceBudget });
    const list = await run('tar', ['-tzf', archive], { ms: evidenceBudget, stdio: ['ignore', 'ignore', 'pipe'] });
    if (list.code !== 0) throw new Error('The stopped writable-layer archive could not be read.');
    const files = {};
    for (const file of evidenceFiles) files[file] = await sha256(join(stage, file));

    const [current] = await inspect(docker, [facts.id]);
    if (JSON.stringify(stoppedFacts(current, facts.execution)) !== JSON.stringify(facts) || (await upperDirectory(current, root)) !== upper) {
      throw new Error('Container facts or writable layer changed during preservation.');
    }
    const receipt = { schema, facts, upperDirectory: upper, files, taskLog, createdAt: new Date().toISOString() };
    writeFileSync(join(stage, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
    await output('mv', ['--no-clobber', '--no-target-directory', '--', stage, destination]);
    try {
      lstatSync(stage);
    } catch (error) {
      if (error.code === 'ENOENT') return { directory: destination, schema };
      throw error;
    }
    throw new Error('Preservation output already exists.');
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

export async function cleanupPreserved(docker, directory, approval) {
  privateDir(directory);
  const receiptPath = join(directory, 'receipt.json');
  const stat = lstatSync(receiptPath);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Invalid stopped writable-layer receipt.');
  const data = readFileSync(receiptPath, { flag: constants.O_RDONLY | constants.O_NOFOLLOW });
  const digest = createHash('sha256').update(data).digest('hex');
  if (approval && approval !== digest) throw new Error('The reviewed receipt changed.');
  const receipt = JSON.parse(data);
  if (receipt.schema !== schema || !/^[a-f0-9]{64}$/.test(receipt.facts?.id) || !executionId.test(receipt.facts?.execution)) throw new Error('Invalid stopped writable-layer receipt.');
  for (const file of evidenceFiles) {
    const path = join(directory, file);
    if (!lstatSync(path).isFile() || (await sha256(path)) !== receipt.files?.[file]) throw new Error(`Preservation evidence failed verification: ${file}`);
  }
  const [row] = await inspect(docker, [receipt.facts.id]);
  const root = realpathSync(await dockerRoot(docker));
  if (JSON.stringify(stoppedFacts(row, receipt.facts.execution)) !== JSON.stringify(receipt.facts) || (await upperDirectory(row, root)) !== receipt.upperDirectory) {
    throw new Error('The stopped task container differs from its preservation receipt.');
  }
  if ((await sha256(receiptPath)) !== digest) throw new Error('The stopped writable-layer receipt changed during verification.');
  if (approval) await docker(['container', 'rm', '--', receipt.facts.id]);
  return { mode: approval ? 'removed' : 'preview', container: receipt.facts.id, name: receipt.facts.name, execution: receipt.facts.execution, approval: digest };
}
