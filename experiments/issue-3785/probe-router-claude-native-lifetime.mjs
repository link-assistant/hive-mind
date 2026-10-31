#!/usr/bin/env node
// Exercise Claude's actual command-stream stdin startup, without a native AI CLI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { $ as nativeDollar } from 'command-stream';
import { buildRouterTaskEnv } from '../../src/router-isolation.lib.mjs';
import { ROUTER_ROUTE_DIALECTS } from '../../src/router-routes.lib.mjs';

globalThis.use = async name => {
  const packageName = name.replace(/@\d[^/]*$/, '');
  if (packageName === 'command-stream') return { $: () => assert.fail('unexpected global command') };
  if (packageName === 'fs') return { ...fs, default: fs };
  if (packageName === 'os') return { ...os, default: os };
  if (packageName === 'path') return { ...path, default: path };
  if (packageName === 'getenv') return (key, fallback) => process.env[key] ?? fallback;
  return import(packageName);
};
const { executeClaudeCommand } = await import('../../src/claude.lib.mjs');
const fixture = fileURLToPath(new URL('./router-lifetime-native-fixture.mjs', import.meta.url));

function alive(pid) {
  if (!pid) return false;
  try {
    return !/^\d+ \(.+\) Z /.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

for (const security of [true, false])
  test(`Router Claude live input stops the real native group on ${security ? 'security refusal' : 'abandoned logging'}`, { timeout: 10_000, skip: process.platform !== 'linux' }, async t => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'router-native-lifetime-'));
    const cwd = path.join(home, 'workspace');
    fs.mkdirSync(cwd);
    fs.mkdirSync(path.join(home, 'tmp'));
    const inherited = { ...process.env };
    Object.assign(process.env, { HOME: home, TMPDIR: path.join(home, 'tmp'), XDG_CONFIG_HOME: path.join(home, 'config'), XDG_DATA_HOME: path.join(home, 'data'), XDG_CACHE_HOME: path.join(home, 'cache'), HIVE_MIND_STATE_DIR: path.join(home, 'state'), HIVE_MIND_MODELS_HOT_LOAD: '0', HIVE_MIND_MAX_TRANSIENT_ERROR_RETRIES: '0', NODE_OPTIONS: '--max-old-space-size=32', ROUTER_LIFETIME_PID_FILE: path.join(home, 'pids'), ...buildRouterTaskEnv({ tool: 'claude', baseUrl: 'https://router.invalid', token: 'synthetic-router-task', homeDir: home, dialect: ROUTER_ROUTE_DIALECTS.canonical }), HIVE_MIND_ROUTER_AUTH_GUARD_INTERVAL_MS: '100' });
    let command;
    let pids;
    let queries = 0;
    let observedAlive = false;
    let stoppedDuringLogging = false;
    const intervals = new Set();
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    globalThis.setInterval = (...args) => {
      const timer = originalSetInterval(...args);
      intervals.add(timer);
      return timer;
    };
    globalThis.clearInterval = timer => {
      intervals.delete(timer);
      return originalClearInterval(timer);
    };
    t.after(async () => {
      for (const timer of intervals) originalClearInterval(timer);
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
      command?.kill('SIGKILL');
      for (let count = 0; count < 100 && pids && (alive(pids.parent) || alive(pids.child)); count++) await delay(10);
      assert.ok(!pids || (!alive(pids.parent) && !alive(pids.child)), 'reap all live fixture processes before deleting their state');
      for (const name of Object.keys(process.env)) if (!(name in inherited)) delete process.env[name];
      Object.assign(process.env, inherited);
      fs.rmSync(home, { recursive: true, force: true });
    });
    const dollar = options => strings => {
      const display = strings.join(' ');
      assert.ok(Array.isArray(strings), 'preserve the production tagged command');
      if (display.includes('gh ')) {
        assert.ok(++queries <= 6, 'bounded synthetic GitHub reads');
        return { code: 0, stdout: '[]', stderr: '' };
      }
      assert.equal(command, undefined, 'one real native fixture');
      // Keep production's real stdin/stream runner; only replace the AI executable.
      const launch = nativeDollar(options);
      command = launch`${process.execPath} --max-old-space-size=32 ${fixture}`;
      return command;
    };
    const result = await executeClaudeCommand({
      tempDir: cwd,
      owner: 'synthetic',
      repo: 'synthetic',
      prNumber: 1,
      branchName: 'issue-3785-test',
      prompt: 'Synthetic request.',
      systemPrompt: 'Synthetic system.',
      argv: { tool: 'claude', model: 'claude-sonnet-4-6', attribution: 'none', acceptIncommingCommentsAsInput: true, auxiliaryModelCallsDisabled: false },
      log: async text => {
        if (!command || !text.includes('Command details:')) return;
        for (let count = 0; count < 100 && !fs.existsSync(process.env.ROUTER_LIFETIME_PID_FILE); count++) await delay(10);
        pids = JSON.parse(fs.readFileSync(process.env.ROUTER_LIFETIME_PID_FILE, 'utf8'));
        observedAlive = alive(pids.parent) && alive(pids.child);
        if (security) fs.writeFileSync(path.join(home, '.git-credentials'), 'synthetic forbidden credential');
        for (let count = 0; count < 100 && (alive(pids.parent) || alive(pids.child)); count++) await delay(10);
        stoppedDuringLogging = !alive(pids.parent) && !alive(pids.child);
        throw new Error('synthetic command logging failure');
      },
      formatAligned: (_icon, label, value = '') => `${label} ${value}`,
      getResourceSnapshot: async () => ({ memory: 'Mem:\n available', load: '0.00' }),
      getLogFile: () => path.join(home, 'execution.log'),
      setLogFile: () => {},
      claudePath: fixture,
      $: dollar,
      calculatePricing: async () => ({ totalCostUSD: null }),
      waitForRetryDelay: async () => assert.fail('security failures must not retry'),
    });
    if (!security) for (let count = 0; count < 100 && (alive(pids.parent) || alive(pids.child)); count++) await delay(10);
    assert.deepEqual({ startedBeforeOutput: observedAlive, stopped: security ? stoppedDuringLogging : !alive(pids.parent) && !alive(pids.child), securityRefusal: Boolean(result.routerAuthViolation), remainingIntervals: intervals.size }, { startedBeforeOutput: true, stopped: true, securityRefusal: security, remainingIntervals: 0 }, 'stop the real native group and live-input polling before the failed attempt returns');
  });
