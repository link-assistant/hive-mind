import { spawn } from 'node:child_process';

// Shared across simultaneous reports: optional diagnostics must not start
// every installed language runtime at once and exhaust a container.
export const VERSION_COMMAND_CONCURRENCY = 4;
let active = 0;
const waiting = [];

async function acquire() {
  if (active >= VERSION_COMMAND_CONCURRENCY) await new Promise(resolve => waiting.push(resolve));
  else active++;
}

function release() {
  const next = waiting.shift();
  if (next) next();
  else active--;
}

/** Run a bounded probe, cleaning up its shell and descendants before returning. */
export async function execVersionCommand(command, timeout = 5000, { onDiagnostic = null } = {}) {
  await acquire();
  try {
    return await new Promise(resolve => {
      const grouped = process.platform !== 'win32';
      const child = spawn(command, { shell: true, detached: grouped, stdio: ['ignore', 'pipe', 'pipe'] });
      const started = Date.now();
      onDiagnostic?.(`version probe started: pid=${child.pid ?? 'unavailable'}, timeout=${timeout}ms, command=${command}`);
      let output = '';
      let bytes = 0;
      let failed = false;
      let drainTimer = null;
      const stop = () => {
        if (grouped && child.pid) {
          try {
            // exec's timeout only kills the shell. Its grandchildren need the
            // dedicated process group, including after a successful shell exit.
            process.kill(-child.pid, 'SIGKILL');
          } catch {
            /* the group already exited */
          }
        }
        child.kill('SIGKILL');
        // Let killed descendants close their pipes before settling. A detached
        // descendant may retain a pipe, so cleanup itself remains bounded.
        clearTimeout(drainTimer);
        drainTimer = setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
        }, 100);
      };
      const timer = setTimeout(() => {
        failed = true;
        onDiagnostic?.(`version probe timed out: pid=${child.pid}, elapsed=${Date.now() - started}ms`);
        stop();
      }, timeout);
      const consume = (chunk, stdout) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 1024 * 1024) {
          failed = true;
          stop();
        } else if (stdout) output += chunk.toString();
      };
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => consume(chunk, true));
      child.stderr.on('data', chunk => consume(chunk, false));
      child.on('error', () => {
        failed = true;
      });
      child.on('exit', stop);
      child.on('close', code => {
        clearTimeout(timer);
        clearTimeout(drainTimer);
        onDiagnostic?.(`version probe finished: pid=${child.pid ?? 'unavailable'}, code=${code}, elapsed=${Date.now() - started}ms, bytes=${bytes}, failed=${failed}`);
        const trimmed = output.trim();
        resolve(failed || code !== 0 || !trimmed || trimmed.includes('not found') ? null : trimmed);
      });
    });
  } finally {
    release();
  }
}
