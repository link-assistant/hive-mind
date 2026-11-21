/**
 * `docker pull` that outlives the time Hive Mind is willing to wait for it
 * (issue #3207).
 *
 * `execFile` with a `timeout` kills the `docker pull` client when the budget
 * elapses. The daemon then cancels the pull, and with the containerd image
 * store the layers it already fetched stay pinned by a containerd lease —
 * about 17 GB of a Formal AI image, invisible to `docker image ls` and
 * `docker image prune`, for the lease's 6 hours. The next task then starts the
 * same download from scratch and is cut short again.
 *
 * A pull started here is detached from the caller: when the budget elapses the
 * caller stops waiting and gets a timeout error, but the pull keeps running.
 * Its layers become an ordinary image instead of leased leftovers, and the next
 * task finds that image locally. The daemon joins a second pull of the same
 * reference to the running one, so a retry does not download anything twice.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3207
 */

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

/**
 * The real `execFile` runner the Formal AI modules default to. A pull is
 * detached only when it runs through this runner; a test stub passed as `run`
 * keeps driving `docker pull` itself.
 */
export const dockerExecFileAsync = promisify(execFile);

/**
 * Run `docker <args>` detached, with its output in a temporary file rather
 * than a pipe (a pipe whose reader is gone would end the pull with SIGPIPE).
 *
 * Resolves with `{ stdout }` when the pull finishes in time. Rejects with the
 * pull's own output as `stderr` when it fails, or — when `timeoutMs` elapses
 * first — with `code: 'ETIMEDOUT'` and `continuesInBackground: true` while the
 * pull goes on.
 */
export const startDetachedDockerPull = (args, { timeoutMs, spawnImpl = spawn, tmpDir = os.tmpdir() } = {}) =>
  new Promise((resolve, reject) => {
    const outputDir = fs.mkdtempSync(path.join(tmpDir, 'hive-mind-docker-pull-')); // hive-sync-ok: one small temp dir per pull
    const outputPath = path.join(outputDir, 'output.log');
    const cleanup = () => fs.rmSync(outputDir, { recursive: true, force: true }); // hive-sync-ok: one small temp dir per pull
    const readOutput = () => {
      try {
        return fs.readFileSync(outputPath, 'utf8').trim(); // hive-sync-ok: the pull's short progress log
      } catch {
        return '';
      }
    };
    const fd = fs.openSync(outputPath, 'w'); // hive-sync-ok: handed to the child as stdout/stderr
    let child;
    try {
      child = spawnImpl('docker', args, { detached: true, stdio: ['ignore', fd, fd] });
    } catch (error) {
      fs.closeSync(fd); // hive-sync-ok: closing the descriptor handed to the child
      cleanup();
      reject(error);
      return;
    }
    fs.closeSync(fd); // hive-sync-ok: the child holds its own copy of the descriptor
    let settled = false;
    let timer = null;
    child.on('error', error => {
      if (timer) clearTimeout(timer);
      cleanup();
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on('exit', (code, signal) => {
      if (timer) clearTimeout(timer);
      const output = readOutput();
      cleanup();
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve({ stdout: output, stderr: '' });
        return;
      }
      const error = new Error(`Command failed: docker ${args.join(' ')}${output ? `\n${output}` : ''}`);
      Object.assign(error, { code, signal, stderr: output, stdout: '' });
      reject(error);
    });
    const ms = Number(timeoutMs);
    if (!Number.isFinite(ms) || ms <= 0) return;
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      // Stop waiting, not pulling: the pull no longer keeps this process alive.
      child.unref();
      const error = new Error(`docker ${args.join(' ')} did not finish in time; it continues in the background (pid ${child.pid ?? 'unknown'})`);
      Object.assign(error, { code: 'ETIMEDOUT', continuesInBackground: true, pid: child.pid ?? null, stderr: '', stdout: '' });
      reject(error);
    }, ms);
    timer.unref?.();
  });

/**
 * Pull through the caller's `run` seam: detached when that is the real
 * runner, as a plain `run('docker', args)` otherwise.
 */
export const pullDockerImage = (args, { run = dockerExecFileAsync, timeoutMs, spawnImpl } = {}) => (run === dockerExecFileAsync ? startDetachedDockerPull(args, { timeoutMs, spawnImpl }) : run('docker', args, { encoding: 'utf8', timeout: timeoutMs }));

export default { dockerExecFileAsync, pullDockerImage, startDetachedDockerPull };
