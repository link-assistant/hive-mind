import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

export function run(command, args, { ms = 5000, maxBytes = 2 * 1024 * 1024, check, input, keepInput = false, stdio } = {}) {
  check?.();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, shell: false, stdio: stdio ?? ['pipe', 'pipe', 'pipe'] });
    const chunks = [[], []];
    let bytes = 0;
    let failure;
    let termination;
    function killGroup() {
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (signalError) {
          if (signalError.code !== 'ESRCH') child.kill('SIGKILL');
        }
      }
    }
    function stop(error) {
      if (failure) return;
      failure = error;
      if (keepInput && child.pid) {
        // Closing stdin asks the in-container read-only scanner to cancel.
        // Killing the local CLI alone cannot kill a Docker exec subprocess.
        child.stdin?.end();
        termination = setTimeout(killGroup, 250);
      } else {
        killGroup();
      }
    }
    const timer = setTimeout(() => stop(new Error(`${command} exceeded its time budget`)), ms);
    const guard =
      check &&
      setInterval(() => {
        try {
          check();
        } catch (error) {
          stop(error);
        }
      }, 500);
    [child.stdout, child.stderr].forEach((stream, index) =>
      stream?.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) stop(new Error(`${command} exceeded its output budget`));
        if (!failure) chunks[index].push(chunk);
      })
    );
    child.stdin?.on('error', () => {});
    if (keepInput) child.stdin?.write(input);
    else child.stdin?.end(input);
    child.on('error', stop);
    child.on('close', code => {
      clearTimeout(timer);
      clearTimeout(termination);
      clearInterval(guard);
      if (failure) reject(failure);
      else resolve({ code, stdout: Buffer.concat(chunks[0]).toString(), stderr: Buffer.concat(chunks[1]).toString() });
    });
  });
}

export async function output(command, args, options) {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    const detail = process.env.HIVE_MANAGER_STORAGE_DEBUG === '1' ? `: ${result.stderr.trim().slice(-1000)}` : '';
    throw new Error(`${command} exited with status ${result.code ?? 'unknown'}${detail}`);
  }
  return result.stdout.trimEnd();
}

export class MemoryPressure extends Error {}

export async function memoryGuard({ read = readFileSync, dockerPids } = {}) {
  const pids = dockerPids ?? (await output('pgrep', ['-x', 'dockerd'])).split(/\s+/);
  if (!pids.length || pids.some(pid => !/^\d+$/.test(pid))) throw new Error('Cannot monitor the local Docker daemon.');
  const scopes = new Set();
  for (const pid of ['self', ...pids]) {
    const scope = /^0::(.*)$/m.exec(read(`/proc/${pid}/cgroup`, 'utf8'))?.[1];
    if (scope === undefined) continue;
    for (let path = scope; ; path = path.slice(0, path.lastIndexOf('/')) || '/') {
      scopes.add(`/sys/fs/cgroup${path === '/' ? '' : path}`);
      if (path === '/') break;
    }
  }
  let nextSample = 0;
  let stopped;
  function sample() {
    const now = performance.now();
    if (now < nextSample) return;
    nextSample = now + 250;
    const available = Number(/^MemAvailable:\s+(\d+)/m.exec(read('/proc/meminfo', 'utf8'))?.[1]);
    if (!Number.isFinite(available) || available < 1536 * 1024) throw new MemoryPressure('Host memory available fell below 1536 MiB.');
    for (const pid of pids) {
      const status = read(`/proc/${pid}/status`, 'utf8');
      const rss = Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1]);
      if (!/^Name:\s+dockerd$/m.test(status) || !Number.isFinite(rss) || rss > 2560 * 1024) {
        throw new MemoryPressure('Docker daemon memory or process identity is outside the cleanup limits.');
      }
    }
    for (const scope of scopes) {
      let limit;
      try {
        limit = read(`${scope}/memory.max`, 'utf8').trim();
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        // The root cgroup and children without the memory controller can omit
        // memory.max. Ensure the scope is still present and check its ancestors.
        read(`${scope}/cgroup.controllers`, 'utf8');
        continue;
      }
      if (limit === 'max') continue;
      const max = Number(limit);
      const usage = Number(read(`${scope}/memory.current`, 'utf8'));
      if (!Number.isFinite(max) || !Number.isFinite(usage) || max - usage < 256 * 1024 ** 2) {
        throw new MemoryPressure('The host or daemon cgroup has less than 256 MiB of memory headroom.');
      }
    }
  }
  return () => {
    if (stopped) throw stopped;
    try {
      sample();
    } catch (error) {
      stopped = error instanceof MemoryPressure ? error : new MemoryPressure(`Memory guard unavailable: ${error.message}`);
      throw stopped;
    }
  };
}
