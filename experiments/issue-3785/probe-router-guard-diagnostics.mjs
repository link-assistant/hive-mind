#!/usr/bin/env node
// A finite child isolates unhandled logger rejections from the test runner.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { buildRouterTaskEnv } from '../../src/router-isolation.lib.mjs';
import { ROUTER_ROUTE_DIALECTS } from '../../src/router-routes.lib.mjs';
import { startRouterAuthGuard } from '../../src/router-auth-guard.lib.mjs';

if (process.argv[2] === '--child') {
  const home = process.argv[3];
  const mode = process.argv[4];
  const env = { ...buildRouterTaskEnv({ tool: 'agent', baseUrl: 'https://router.invalid', token: 'synthetic-router-task', homeDir: home, dialect: ROUTER_ROUTE_DIALECTS.canonical }), HOME: home };
  const failing = () => {
    throw new Error('synthetic diagnostic failure');
  };
  const handlerFails = mode.startsWith('handler-');
  const asyncLogger = mode.endsWith('async-reject');
  const log = text => {
    if (handlerFails && text.includes('armed:')) return;
    if (asyncLogger) return Promise.reject(new Error('synthetic diagnostic failure'));
    return failing();
  };
  let stops = 0;
  const guard = startRouterAuthGuard({
    tool: 'agent',
    env,
    cwd: home,
    log,
    intervalMs: 100,
    onViolation: () => {
      stops++;
      if (handlerFails) {
        if (mode.includes('handler-async-')) return Promise.reject(new Error('synthetic stop handler failure'));
        throw new Error('synthetic stop handler failure');
      }
    },
  });
  try {
    await guard.first;
    assert.equal(guard.violation, null);
    fs.writeFileSync(path.join(home, '.git-credentials'), 'synthetic non-Router credential');
    await delay(250);
    assert.equal(stops, 1);
    assert.ok(guard.violation);
    await guard.check();
    assert.equal(stops, 1);
  } finally {
    guard.stop();
  }
} else {
  for (const mode of ['sync-throw', 'async-reject', 'handler-sync-sync-throw', 'handler-sync-async-reject', 'handler-async-sync-throw', 'handler-async-async-reject'])
    test(`Router guard diagnostic ${mode} cannot abandon native monitoring`, { timeout: 10_000 }, t => {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'router-guard-diagnostics-'));
      t.after(() => fs.rmSync(home, { recursive: true, force: true }));
      const result = spawnSync(process.execPath, ['--max-old-space-size=32', fileURLToPath(import.meta.url), '--child', home, mode], { encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024 });
      assert.equal(result.error, undefined, 'bounded diagnostic fixture completes');
      assert.equal(result.status, 0, result.stderr);
    });
}
