#!/usr/bin/env node
/** Required packaged-image stock gate. No auth, inference, repair or downloads. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { CODEX_STOCK_SKILLS, validateCodexStockSkills } from './codex-stock-skills.lib.mjs';
import { assertCodexStockSkillDiscovery } from './codex-stock-catalog.lib.mjs';
import { runAgentConfigAudit } from './agent-config-audit.lib.mjs';

const execute = promisify(execFile);
const DEADLINE_MS = 30_000;

// A stock probe must not inherit provider credentials, config overrides or
// preload hooks from the image verifier's caller. Keep even version commands
// outside its real home and repository. PATH only locates installed binaries.
const probeEnvironment = home => ({
  PATH: process.env.PATH,
  HOME: home,
  CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
  CODEX_HOME: path.join(home, '.codex'),
  CODEX_SQLITE_HOME: path.join(home, '.codex'),
  XDG_CONFIG_HOME: path.join(home, '.config'),
  XDG_DATA_HOME: path.join(home, '.local/share'),
  XDG_STATE_HOME: path.join(home, '.local/state'),
  XDG_CACHE_HOME: path.join(home, '.cache'),
  TOKIO_WORKER_THREADS: '2',
  DISABLE_AUTOUPDATER: '1',
  CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
});

async function materializeStock(command, home, cwd, env) {
  const child = spawn(command, ['-c', 'features.remote_plugin=false', '-c', 'cli_auth_credentials_store="file"', 'app-server'], {
    cwd,
    env,
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
  child.once('close', () => rejectFatal(new Error('Stock CLI exited before verification completed.')));
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
    // No inference or tools are requested. Terminate the idle native server and
    // await reaping before removing its private test home.
    if (child.exitCode === null) child.kill('SIGKILL');
    await closed;
  }
}

export async function verifyAgentRuntime({ homeDir = os.homedir(), codexCommand = 'codex', claudeCommand = 'claude' } = {}) {
  await runAgentConfigAudit({ homeDir, autoRepair: false, requireClean: true });
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'hive-stock-gate-'));
  try {
    const home = path.join(fixture, 'home');
    const cwd = path.join(fixture, 'project');
    await mkdir(path.join(home, '.codex'), { recursive: true });
    await mkdir(path.join(home, '.claude'));
    await mkdir(cwd);
    const env = probeEnvironment(home);
    for (const [command, expected] of [
      [claudeCommand, '2.1.310 (Claude Code)'],
      [codexCommand, CODEX_STOCK_SKILLS.cliVersion],
    ]) {
      const { stdout } = await execute(command, ['--version'], { env, cwd, maxBuffer: 64 * 1024, signal: AbortSignal.timeout(DEADLINE_MS) });
      assert.equal(stdout.trim(), expected, 'Installed CLI version differs from the pinned runtime.');
    }
    await materializeStock(codexCommand, home, cwd, env);
    await runAgentConfigAudit({ homeDir, autoRepair: false, requireClean: true });
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await verifyAgentRuntime();
    console.log('Installed Claude/Codex versions, known global baseline and pristine Codex stock runtime verified.');
  } catch {
    console.error('Installed agent runtime verification failed. Check pinned versions and restore a verified clean baseline.');
    process.exitCode = 1;
  }
}
