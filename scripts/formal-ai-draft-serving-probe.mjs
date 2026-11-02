#!/usr/bin/env node

/**
 * Serving preflight for one Formal AI draft attempt (issue #3909).
 *
 * Runs *inside the exact Hive Mind image* the attempt selected, with the
 * selected Formal AI binary mounted where solve will find it, before solve
 * starts. It records what would actually serve the task:
 *
 *   - which file `formal-ai` resolves to on PATH and its sha256;
 *   - `formal-ai --version`, `solve --version` (Hive Mind) and `agent --version`;
 *   - a real `formal-ai serve --agent-mode` started the way solve starts it,
 *     the version its `/health` answers with, and the sha256 of the server
 *     process's own executable (`/proc/<pid>/exe`) — version equality alone
 *     cannot tell two builds of one version apart.
 *
 * It prints one JSON object and exits 0 even when something failed (`ok:
 * false`, `error`), so the runner on the host decides; nothing here touches the
 * issue, a branch or a token. Only Node built-ins are used, because the image's
 * own dependencies are not this checkout's.
 *
 * Usage (from scripts/formal-ai-draft.mjs):
 *   docker run --rm --user box -v <this file>:/home/box/.formal-ai-draft-probe.mjs:ro \
 *     -v <binary>:/usr/local/bin/formal-ai:ro <image> node /home/box/.formal-ai-draft-probe.mjs
 */

import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdtempSync } from 'node:fs';
import { access, constants } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const READY_TIMEOUT_MS = Number(process.env.FORMAL_AI_DRAFT_PROBE_READY_MS || 60_000);

const sha256 = path =>
  new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('error', reject)
      .on('data', chunk => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });

const which = async name => {
  for (const dir of String(process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    try {
      await access(join(dir, name), constants.X_OK);
      return join(dir, name);
    } catch {
      // next
    }
  }
  return null;
};

const run = (file, args, timeout = 30_000) =>
  new Promise(resolve => {
    execFile(file, args, { timeout, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ ok: !error, stdout: String(stdout || '').trim(), stderr: String(stderr || '').trim(), error: error?.message || null }));
  });

/** The first `x.y.z` in a `--version` answer (`formal-ai 0.355.29`, `2.39.11`). */
const versionOf = text => /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/.exec(String(text || ''))?.[0] || null;

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

const cliVersion = async name => {
  const path = await which(name);
  if (!path) return { path: null, version: null };
  const answer = await run(path, ['--version']);
  return { path, version: versionOf(answer.stdout || answer.stderr), raw: (answer.stdout || answer.stderr || answer.error || '').slice(0, 200) };
};

const probeServer = async binaryPath => {
  const port = await freePort();
  const cwd = mkdtempSync(join(tmpdir(), 'formal-ai-draft-probe-'));
  const apiKey = 'formal-ai-draft-probe';
  const child = spawn(binaryPath, ['serve', '--agent-mode', '--host', '127.0.0.1', '--port', String(port)], { cwd, env: { ...process.env, FORMAL_AI_API_KEY: apiKey, FORMAL_AI_CACHE_DIR: join(cwd, 'cache') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let exited = null;
  child.stdout.on('data', chunk => (output = (output + chunk).slice(-4000)));
  child.stderr.on('data', chunk => (output = (output + chunk).slice(-4000)));
  child.on('exit', (code, signal) => (exited = { code, signal }));
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let health = null;
  let lastError = 'not probed';
  try {
    while (Date.now() < deadline && !exited) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: `Bearer ${apiKey}`, 'X-Api-Key': apiKey }, signal: AbortSignal.timeout(5_000) });
        if (response.ok) {
          health = JSON.parse(await response.text());
          break;
        }
        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = error.message;
      }
      await sleep(250);
    }
    if (!health) return { ok: false, pid: child.pid, error: exited ? `formal-ai serve exited (${JSON.stringify(exited)}): ${output.slice(-500)}` : `formal-ai serve did not answer /health within ${READY_TIMEOUT_MS} ms: ${lastError}` };
    // The process answering /health *is* this child: hash what it executes.
    const exeSha256 = await sha256(`/proc/${child.pid}/exe`);
    return { ok: true, pid: child.pid, healthVersion: typeof health.version === 'string' ? health.version.trim() : null, exeSha256, memory: health.memory ?? null };
  } finally {
    child.kill('SIGTERM');
  }
};

const result = { schema: 'hive-mind/formal-ai-draft-serving-probe/v1', ok: false, probedAt: new Date().toISOString() };
try {
  const binaryPath = await which('formal-ai');
  if (!binaryPath) throw new Error('formal-ai is not on PATH inside the image');
  const formalAi = await cliVersion('formal-ai');
  result.binary = { path: binaryPath, sha256: await sha256(binaryPath), version: formalAi.version, raw: formalAi.raw };
  const hive = await cliVersion('solve');
  result.hive = { version: hive.version, raw: hive.raw };
  const agent = await cliVersion('agent');
  result.agent = { version: agent.version, raw: agent.raw };
  result.server = await probeServer(binaryPath);
  result.ok = result.server.ok;
  if (!result.ok) result.error = result.server.error;
} catch (error) {
  result.error = error.message;
}
process.stdout.write(`${JSON.stringify(result)}\n`);
// The server child was signalled; do not wait on its streams.
process.exit(0);
