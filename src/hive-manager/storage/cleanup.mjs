import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { absolute, dockerRoot, executionId, inspect, inventory, localDocker, mountTable, overlaps, runtimeRoots, upperDirectory } from './lib/docker.mjs';
import { openTree, planFiles, removeApproved } from './lib/files.mjs';
import { MemoryPressure, memoryGuard, run } from './lib/process.mjs';
import { pinnedScanner } from './lib/scanner.mjs';

const entry = fileURLToPath(new URL('./main.mjs', import.meta.url));
export const jobDirectory = '/var/lib/hive-manager/scoped-cleanup';

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return null;
  }
}

function save(path, value) {
  const temporary = `${path}.new`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value) + '\n');
    fsyncSync(fd);
    renameSync(temporary, path);
    const directory = openSync(dirname(path), 'r');
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } finally {
    closeSync(fd);
  }
}

function running(row) {
  return row.state.Status === 'running' && row.state.Paused === false && row.state.Running === true && Number.isSafeInteger(row.state.Pid) && row.state.Pid > 0;
}

function hostProtected(root, directory, rows, stateDir) {
  const paths = [
    root,
    ...runtimeRoots,
    directory,
    stateDir,
    ...mountTable()
      .map(mount => mount.path)
      .filter(path => path !== '/'),
  ];
  for (const row of rows) {
    for (const mount of row.mounts ?? []) {
      if (mount.Source) paths.push(mount.Source);
    }
  }
  for (const path of [...paths]) {
    if (!absolute(path)) throw new Error('Cannot verify the host mount exclusions.');
    try {
      paths.push(realpathSync(path));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return [...new Set(paths)];
}

function containerProtected(row) {
  return [
    ...new Set([
      ...runtimeRoots,
      ...(row.mounts ?? []).map(mount => mount.Destination),
      ...Object.keys(row.tmpfs ?? {}),
      ...mountTable(row.state.Pid)
        .map(mount => mount.path)
        .filter(path => path !== '/'),
    ]),
  ];
}

function taskIdentity(row) {
  return `${row.id}/${row.state.Pid}/${row.state.StartedAt}`;
}

function liveTask(row) {
  const pid = row.state.Pid;
  const ns = readlinkSync(`/proc/${pid}/ns/mnt`);
  const scope = /^0::(.*)$/m.exec(readFileSync(`/proc/${pid}/cgroup`, 'utf8'))?.[1];
  if (!scope || !absolute(scope) || scope === '/') throw new Error('A task cgroup v2 freezer could not be verified.');
  return () => {
    if (readlinkSync(`/proc/${pid}/ns/mnt`) !== ns) throw new Error('The task mount namespace changed.');
    for (let group = scope; group !== '/'; group = dirname(group)) {
      const events = readFileSync(`/sys/fs/cgroup${group}/cgroup.events`, 'utf8');
      if (!/^frozen 0$/m.test(events) || readFileSync(`/sys/fs/cgroup${group}/cgroup.freeze`, 'utf8').trim() !== '0') {
        throw new Error('The task is paused or freezing.');
      }
    }
  };
}

export async function scopedCleanup({ docker, directory, stateDir, approved, check, scan, progress }) {
  const deadline = performance.now() + 30 * 60_000;
  const guard = () => {
    check();
    if (performance.now() >= deadline) throw new Error('Scoped cleanup time budget exhausted.');
  };
  const options = { check: guard };
  const root = realpathSync(await dockerRoot(docker, options));
  if (overlaps(root, realpathSync(directory))) throw new Error('Cleanup state overlaps Docker storage.');
  if (approved && approved.root !== root) throw new Error('Docker data root changed after the preview.');
  const rows = await inventory(docker, options);

  const plans = [];
  let fileCount = 0;
  async function consider(name, identity, paths, getTrees, refresh, container) {
    const approvedScope = approved?.plans.find(plan => plan.identity === identity);
    if (approved && !approvedScope?.files.length) return;
    let trees;
    try {
      guard();
      const candidates = await scan(paths, docker, container);
      const current = await refresh();
      trees = await getTrees(current);
      const boundary = current.paths;
      const files = planFiles(trees.view, trees.upper, candidates, boundary, guard);
      if (!approved) {
        if (fileCount + files.length > 25_000) throw new Error('The preview exceeds its approved file inventory limit.');
        fileCount += files.length;
        plans.push({ identity, files });
        progress({ name, files: files.length, bytes: files.reduce((bytes, file) => bytes + file.bytes, 0) });
        return;
      }
      const oldFiles = new Map(approvedScope.files.map(file => [file.path, file]));
      let removed = 0;
      let bytes = 0;
      for (const file of files) {
        const old = oldFiles.get(file.path);
        if (!old) continue;
        if (
          removeApproved(trees.view, trees.upper, old, file, () => {
            guard();
            trees.assertLive?.();
          })
        ) {
          removed++;
          bytes += file.bytes;
          progress({ name, removed, bytes }, false);
        }
      }
      progress({ name, removed, bytes });
    } catch (error) {
      if (error instanceof MemoryPressure) throw error;
      guard();
      progress({ name, skipped: error.message });
    } finally {
      trees?.upper?.close();
      trees?.view.close();
    }
  }

  const hostPaths = () => hostProtected(root, directory, rows, stateDir);
  await consider(
    'host',
    'host',
    hostPaths(),
    () => ({ view: openTree('/') }),
    async () => ({
      paths: approved ? hostProtected(root, directory, await inventory(docker, options), stateDir) : hostPaths(),
    })
  );
  for (const row of rows) {
    guard();
    if (!running(row)) {
      progress({ name: row.name, skipped: `container state is ${row.state.Status}` });
      continue;
    }
    try {
      const upper = await upperDirectory(row, root, options);
      const assertLive = approved ? liveTask(row) : undefined;
      await consider(
        row.name,
        taskIdentity(row),
        containerProtected(row),
        () => {
          const backing = openTree(upper);
          try {
            return { view: openTree(`/proc/${row.state.Pid}/root`), upper: backing, assertLive };
          } catch (error) {
            backing.close();
            throw error;
          }
        },
        async () => {
          const [current] = await inspect(docker, [row.id], options);
          if (!running(current) || taskIdentity(current) !== taskIdentity(row) || (await upperDirectory(current, root, options)) !== upper) {
            throw new Error('Container state or writable layer changed during scanning.');
          }
          assertLive?.();
          return { paths: containerProtected(current) };
        },
        row.id
      );
    } catch (error) {
      if (error instanceof MemoryPressure) throw error;
      guard();
      progress({ name: row.name, skipped: error.message });
    }
  }
  guard();
  return { root, plans };
}

function checkDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || realpathSync(directory) !== directory || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) {
    throw new Error('Scoped cleanup requires a private state directory owned by the operator.');
  }
}

export async function readCleanupStatus(directory) {
  const file = join(directory, 'status.json');
  const state = readJson(file);
  if (!state || state.status !== 'running') return state;
  const probe = await run('flock', ['-n', '-E', '75', join(directory, 'lock'), 'true']);
  if (probe.code === 75) return state;
  if (probe.code !== 0) throw new Error('The cleanup lock could not be checked.');
  const current = readJson(file);
  return current?.id === state.id && current.status === 'running' ? { ...current, status: 'interrupted' } : current;
}

export async function launchCleanup(directory, socket, instance, stateDir, approval) {
  checkDirectory(directory);
  const id = randomUUID();
  if (approval) {
    const state = await readCleanupStatus(directory);
    if (state?.id !== approval || state.status !== 'completed' || state.mode !== 'preview') throw new Error('Apply requires the latest completed preview.');
  }
  return launchLocked(directory, id, [process.execPath, entry, 'worker', socket, instance, stateDir, id, approval ?? '']);
}

export async function launchLocked(directory, id, command) {
  const child = spawn('flock', ['-n', '-E', '75', join(directory, 'lock'), ...command], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  let exit;
  child.on('error', error => {
    exit = error;
  });
  child.on('exit', code => {
    exit = code;
  });
  for (let i = 0; i < 50 && exit === undefined; i++) {
    const state = readJson(join(directory, 'status.json'));
    if (state?.id === id) return state;
    await delay(100);
  }
  const state = await readCleanupStatus(directory);
  if (exit instanceof Error) throw exit;
  if (exit === 75 || state?.status === 'running') throw new Error(`Cleanup is already running. Check --status for job ${state?.id ?? 'details'}.`);
  if (state?.id === id) return state;
  throw new Error('Cleanup startup could not be confirmed. Check --status before submitting another job.');
}

// The flock parent outlives the SSH client and holds the lock until this
// worker exits, including any time spent waiting for a guarded child to stop.
export async function cleanupWorker(directory, socket, instance, stateDir, id, approval) {
  checkDirectory(directory);
  if (!executionId.test(id) || (approval && !executionId.test(approval))) throw new Error('Invalid cleanup job ID.');
  const file = join(directory, 'status.json');
  const prior = readJson(file);
  const preview = join(directory, 'preview.json');
  const state = { id, status: 'running', mode: approval ? 'apply' : 'preview', approval: approval || null, startedAt: new Date().toISOString(), scopes: [] };
  // A killed worker may leave a staging file. This worker holds the same lock.
  rmSync(`${file}.new`, { force: true });
  rmSync(`${preview}.new`, { force: true });
  const approved = approval && readJson(preview);
  if (approval && (prior?.id !== approval || prior.status !== 'completed' || approved?.id !== approval || approved.socket !== socket || approved.instance !== instance || approved.stateDir !== stateDir)) {
    throw new Error('Apply requires the latest completed preview for this deployment.');
  }
  save(file, state);
  let temp;
  try {
    const check = await memoryGuard();
    const docker = localDocker(socket);
    const root = realpathSync(await dockerRoot(docker, { check }));
    if ([root, ...runtimeRoots].some(path => overlaps(path, directory))) throw new Error('Scoped cleanup state overlaps protected runtime storage.');
    temp = mkdtempSync(join(directory, 'scanner-'));
    chmodSync(temp, 0o700);
    const scan = await pinnedScanner(temp, check);
    const result = await scopedCleanup({
      docker,
      directory,
      stateDir,
      approved,
      check,
      scan,
      progress(entry, persist = true) {
        const index = state.scopes.findIndex(scope => scope.name === entry.name);
        if (index < 0) state.scopes.push(entry);
        else Object.assign(state.scopes[index], entry);
        if (persist) save(file, state);
      },
    });
    if (!approval) {
      save(preview, { ...result, id, socket, instance, stateDir });
      state.previewFile = preview;
    }
    state.status = 'completed';
  } catch (error) {
    state.status = error instanceof MemoryPressure ? 'pressure-stopped' : 'failed';
    state.error = error.message;
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
    state.finishedAt = new Date().toISOString();
    save(file, state);
  }
}
