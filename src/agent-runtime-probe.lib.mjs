/** Run bounded agent runtime probes in a disposable home and project. */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';

export const DEADLINE_MS = 30_000;
class RuntimeProbeCleanupError extends Error {}

async function hasLiveProbeMembers(group) {
  for (const entry of await readdir('/proc', { withFileTypes: true })) {
    if (!/^\d+$/u.test(entry.name)) continue;
    const value = await readFile(`/proc/${entry.name}/stat`, 'utf8').catch(error => {
      if (error.code === 'ENOENT' || error.code === 'ESRCH') return null;
      throw error;
    });
    if (!value) continue;
    // comm may itself contain whitespace or parentheses. The remaining fields
    // start with state, parent PID and process group ID. An exited task shows
    // `Z` until it is reaped, then briefly `X` while it is released (#4055).
    const fields = value
      .slice(value.lastIndexOf(')') + 1)
      .trim()
      .split(/\s+/u);
    if (Number(fields[2]) === group && !['Z', 'X'].includes(fields[0])) return true;
  }
  return false;
}

export async function stopRuntimeProbe(child, closed, grouped) {
  try {
    if (grouped && child.pid) {
      try {
        // Native catalog helpers can survive their leader. Always signal the
        // dedicated group, including when the leader has already exited.
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    child.kill('SIGKILL');
    let reaped = false;
    const reapedProbe = closed.then(() => {
      reaped = true;
    });
    const deadline = Date.now() + 5000;
    while (!reaped || (process.platform === 'linux' && child.pid && (await hasLiveProbeMembers(child.pid)))) {
      if (Date.now() >= deadline) {
        child.stdout.destroy();
        child.stderr.destroy();
        throw new Error('Stock CLI probe descendants did not stop before cleanup.');
      }
      await delay(10);
    }
    await reapedProbe;
  } catch (error) {
    throw new RuntimeProbeCleanupError('Stock CLI probe descendants did not stop before cleanup.', { cause: error });
  }
}

export async function executeVersionProbe(command, { env, cwd, maxBuffer }) {
  const grouped = process.platform !== 'win32';
  const child = spawn(command, ['--version'], { env, cwd, detached: grouped, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise(resolve => child.once('close', resolve));
  const chunks = [];
  let bytes = 0;
  let timer;
  try {
    await new Promise((resolve, reject) => {
      const failed = () => reject(new Error('Installed runtime version probe failed.'));
      timer = setTimeout(failed, DEADLINE_MS);
      child.once('error', failed);
      // Resolve on leader exit so cleanup can terminate helpers that retain
      // stdout/stderr. Wait for drained pipes before returning collected bytes.
      child.once('exit', code => (code === 0 ? resolve() : failed()));
      const consume = (chunk, stdout) => {
        bytes += chunk.length;
        if (bytes > maxBuffer) failed();
        else if (stdout) chunks.push(chunk);
      };
      child.stdout.on('data', chunk => consume(chunk, true));
      child.stderr.on('data', chunk => consume(chunk, false));
    });
  } finally {
    clearTimeout(timer);
    await stopRuntimeProbe(child, closed, grouped);
  }
  if (bytes > maxBuffer) throw new Error('Installed runtime version probe exceeded its fixed bound.');
  return { stdout: Buffer.concat(chunks).toString('utf8') };
}

// A stock probe must not inherit provider credentials, config overrides or
// preload hooks from the image verifier's caller. Keep even version commands
// outside its real home and repository. PATH only locates installed binaries.
export const probeEnvironment = (home, searchPath = process.env.PATH) => ({
  PATH: searchPath,
  HOME: home,
  CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
  CODEX_HOME: path.join(home, '.codex'),
  CODEX_SQLITE_HOME: path.join(home, '.codex'),
  GEMINI_CLI_HOME: home,
  QWEN_HOME: path.join(home, '.qwen'),
  QWEN_RUNTIME_DIR: path.join(home, '.qwen'),
  XDG_CONFIG_HOME: path.join(home, '.config'),
  XDG_DATA_HOME: path.join(home, '.local/share'),
  XDG_STATE_HOME: path.join(home, '.local/state'),
  XDG_CACHE_HOME: path.join(home, '.cache'),
  TOKIO_WORKER_THREADS: '2',
  DISABLE_AUTOUPDATER: '1',
  CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
});

export async function withRuntimeProbe(run, searchPath) {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'hive-stock-gate-'));
  let cleanupSafe = true;
  try {
    const root = await realpath(fixture);
    const home = path.join(root, 'home');
    const cwd = path.join(root, 'project');
    await mkdir(path.join(home, '.codex'), { recursive: true });
    await mkdir(path.join(home, '.claude'));
    await mkdir(cwd);
    return await run({ home, cwd, env: probeEnvironment(home, searchPath) });
  } catch (error) {
    if (error instanceof RuntimeProbeCleanupError) cleanupSafe = false;
    throw error;
  } finally {
    // Retain the private fixture if a native helper could still be using it.
    if (cleanupSafe) await rm(fixture, { recursive: true, force: true });
  }
}
