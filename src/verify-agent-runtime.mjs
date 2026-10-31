#!/usr/bin/env node
/** Required packaged-image stock gate. No auth, inference, repair or downloads. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { CODEX_STOCK_SKILLS, validateCodexStockSkills } from './codex-stock-skills.lib.mjs';
import { assertCodexStockSkillDiscovery } from './codex-stock-catalog.lib.mjs';
import { runAgentConfigAudit } from './agent-config-audit.lib.mjs';
import { verifyNativeGeminiCommand } from './native-gemini-command.lib.mjs';
import { verifyNativeCodexCommand } from './native-codex-command.lib.mjs';

const DEADLINE_MS = 30_000;
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
    // start with state, parent PID and process group ID.
    const fields = value
      .slice(value.lastIndexOf(')') + 1)
      .trim()
      .split(/\s+/u);
    if (Number(fields[2]) === group && fields[0] !== 'Z') return true;
  }
  return false;
}

async function stopRuntimeProbe(child, closed, grouped) {
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
    closed.then(() => {
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
  } catch (error) {
    throw new RuntimeProbeCleanupError('Stock CLI probe descendants did not stop before cleanup.', { cause: error });
  }
}

async function executeVersionProbe(command, { env, cwd, maxBuffer }) {
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
const probeEnvironment = home => ({
  PATH: process.env.PATH,
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

async function materializeStock(command, home, cwd, env) {
  const grouped = process.platform !== 'win32';
  const child = spawn(command, ['-c', 'features.remote_plugin=false', '-c', 'cli_auth_credentials_store="file"', 'app-server'], {
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
    await Promise.race([
      fatal,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Stock CLI verification exceeded its finite deadline.')), DEADLINE_MS);
      }),
      (async () => {
        await request('initialize', { clientInfo: { name: 'hive-stock-runtime-gate', version: '1.0.0' } });
        child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
        const result = await request('skills/list', { cwds: [cwd], forceReload: true });
        assertCodexStockSkillDiscovery({ result, home, cwd });
        const stock = path.join(home, '.codex/skills/.system');
        const snapshot = await validateCodexStockSkills({ directory: stock });
        assert.notEqual(snapshot.get(stock), 'missing', 'Stock CLI did not materialize its pinned runtime.');
        await writeFile(path.join(home, '.codex/config.toml'), '[features]\nremote_plugin = false\n');
        await runAgentConfigAudit({ tool: 'codex', homeDir: home, autoRepair: false, requireClean: true });
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

export async function verifyToolDataRuntimeVersions({ homeDir, cwd, agentCommand = 'agent', opencodeCommand = 'opencode', geminiCommand = 'gemini', qwenCommand = 'qwen', rgCommand = 'rg' }) {
  for (const [command, expected] of [
    [agentCommand, '0.27.0'],
    [opencodeCommand, '1.19.4'],
    [geminiCommand, '0.65.0'],
    [qwenCommand, '0.26.1'],
  ]) {
    const { stdout } = await executeVersionProbe(command, { env: probeEnvironment(homeDir), cwd, maxBuffer: 64 * 1024 });
    assert.equal(stdout.trim(), expected, 'Installed data-storage CLI version differs from the pinned runtime.');
  }
  const { stdout } = await executeVersionProbe(rgCommand, { env: probeEnvironment(homeDir), cwd, maxBuffer: 16 * 1024 });
  assert.match(stdout, /^ripgrep \d+\.\d+\.\d+\b/u, 'Installed Agent search runtime is missing or unusable.');
}

/** Baseline/catalog probes, also exercised with isolated unit-test CLIs.
 * Production callers must use verifyAgentRuntime for native byte admission.
 */
export async function verifyAgentRuntimeBaseline({ homeDir = os.homedir(), env = {}, codexCommand = 'codex', claudeCommand = 'claude', agentCommand = 'agent', opencodeCommand = 'opencode', geminiCommand = 'gemini', qwenCommand = 'qwen' } = {}) {
  await runAgentConfigAudit({ homeDir, env, autoRepair: false, requireClean: true });
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'hive-stock-gate-'));
  let cleanupSafe = true;
  try {
    const home = path.join(fixture, 'home');
    const cwd = path.join(fixture, 'project');
    await mkdir(path.join(home, '.codex'), { recursive: true });
    await mkdir(path.join(home, '.claude'));
    await mkdir(cwd);
    const probeEnv = probeEnvironment(home);
    for (const [command, expected] of [
      [claudeCommand, '2.1.310 (Claude Code)'],
      [codexCommand, CODEX_STOCK_SKILLS.cliVersion],
    ]) {
      const { stdout } = await executeVersionProbe(command, { env: probeEnv, cwd, maxBuffer: 64 * 1024 });
      assert.equal(stdout.trim(), expected, 'Installed CLI version differs from the pinned runtime.');
    }
    await materializeStock(codexCommand, home, cwd, probeEnv);
    await verifyNativeGeminiCommand({ command: geminiCommand });
    await verifyToolDataRuntimeVersions({ homeDir: home, cwd, agentCommand, opencodeCommand, geminiCommand, qwenCommand });
    await runAgentConfigAudit({ homeDir, env, autoRepair: false, requireClean: true });
  } catch (error) {
    if (error instanceof RuntimeProbeCleanupError) cleanupSafe = false;
    throw error;
  } finally {
    // Preserve the private diagnostic fixture if cleanup could not establish
    // quiescence. Never delete storage still in use by a native helper.
    if (cleanupSafe) await rm(fixture, { recursive: true, force: true });
  }
}

/** Audit selected roots and admit the packaged CLI before any native execution. */
export async function verifyAgentRuntime(options = {}) {
  const { homeDir = os.homedir(), env = {}, codexCommand = 'codex' } = options;
  await runAgentConfigAudit({ homeDir, env, autoRepair: false, requireClean: true });
  const native = await verifyNativeCodexCommand({ command: codexCommand, searchPath: env.PATH ?? process.env.PATH });
  await verifyAgentRuntimeBaseline({ ...options, codexCommand: native.entrypoint });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await verifyAgentRuntime({ env: process.env });
    console.log('Installed pinned CLI versions, native Codex and Gemini adapters, known global baseline and pristine Codex stock runtime verified.');
  } catch {
    console.error('Installed agent runtime verification failed. Check pinned versions and restore a verified clean baseline.');
    process.exitCode = 1;
  }
}
