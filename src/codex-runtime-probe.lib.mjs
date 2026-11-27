/** Discover the stock catalog without provider or task execution. */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { DEADLINE_MS, executeVersionProbe, stopRuntimeProbe, withRuntimeProbe } from './agent-runtime-probe.lib.mjs';
import { assertCodexStockSkillDiscovery } from './codex-stock-catalog.lib.mjs';
import { captureCodexStockSkills, validateCodexStockSkills } from './codex-stock-skills.lib.mjs';

async function materializeStock(command, { home, cwd, env }, expected) {
  const grouped = process.platform !== 'win32';
  const child = spawn(command, ['-c', 'features.remote_plugin=false', '-c', 'features.plugins=false', '-c', 'features.apps=false', '-c', 'cli_auth_credentials_store="file"', 'app-server'], {
    cwd,
    env,
    detached: grouped,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  // Native diagnostics may contain paths or input excerpts. Never print them.
  child.stderr.resume();
  let sequence = 0;
  let timer;
  const pending = new Map();
  const closed = new Promise(resolve => child.once('close', resolve));
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  let rejectFatal;
  const fatal = new Promise((_, reject) => {
    rejectFatal = reject;
  });
  let responseBytes = 0;
  child.stdout.on('data', chunk => {
    responseBytes += chunk.length;
    if (responseBytes > 1024 * 1024) {
      rejectFatal(new Error('Stock CLI response exceeded its fixed bound.'));
      child.stdout.destroy();
      child.kill('SIGKILL');
    }
  });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    try {
      const response = JSON.parse(line);
      const waiter = pending.get(response.id);
      if (!waiter) return;
      pending.delete(response.id);
      if (response.error) waiter.reject(new Error('Stock CLI request failed.'));
      else waiter.resolve(response.result);
    } catch {
      rejectFatal(new Error('Stock CLI returned an invalid response.'));
    }
  });
  child.once('error', () => rejectFatal(new Error('Stock CLI could not start.')));
  child.once('exit', () => rejectFatal(new Error('Stock CLI exited before verification completed.')));
  child.stdin.on('error', () => rejectFatal(new Error('Stock CLI input closed.')));
  try {
    return await Promise.race([
      fatal,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Stock CLI verification exceeded its finite deadline.')), DEADLINE_MS);
      }),
      (async () => {
        const init = await request('initialize', { clientInfo: { name: 'hive-stock-runtime-gate', version: '1.0.0' } });
        if (!init || typeof init !== 'object' || Array.isArray(init)) throw new Error('Stock CLI returned an invalid initialization response.');
        child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
        const result = await request('skills/list', { cwds: [cwd], forceReload: true });
        const directory = path.join(home, '.codex/skills/.system');
        const manifest = expected ?? (await captureCodexStockSkills({ directory }));
        assertCodexStockSkillDiscovery({ result, home, cwd, manifest });
        if (expected) {
          const snapshot = await validateCodexStockSkills({ directory, manifest });
          if (snapshot.get(directory) === 'missing') throw new Error('Stock CLI did not materialize its bundled skills.');
        }
        return manifest;
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    lines.close();
    child.stdin.end();
    // No inference or tools are requested. Stop the native server and catalog
    // helpers before the caller removes their private configuration.
    await stopRuntimeProbe(child, closed, grouped);
  }
}

export async function probeCodexStock(command, context, { version, manifest }) {
  const { stdout } = await executeVersionProbe(command, { ...context, maxBuffer: 64 * 1024 });
  const cliVersion = `codex-cli ${version}`;
  if (stdout.trim() !== cliVersion) throw new Error('Installed Codex version differs from the selected package.');
  return { ...(await materializeStock(command, context, manifest)), cliVersion };
}

export async function readCodexStockManifest({ entrypoint, version, searchPath }) {
  return withRuntimeProbe(context => probeCodexStock(entrypoint, context, { version }), searchPath);
}
