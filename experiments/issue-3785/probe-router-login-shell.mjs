#!/usr/bin/env node
// Isolated shell-only reproducer: no real credentials, provider calls or CLI.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const home = await mkdtemp(path.join(os.tmpdir(), 'router-shell-profile-'));
const script = 'test "$OPENAI_API_KEY" = synthetic-router-task && test "$OPENAI_BASE_URL" = https://router.invalid/v1 && test "$CODEX_HOME" = /private-codex';
try {
  await writeFile(path.join(home, '.profile'), 'export OPENAI_API_KEY=synthetic-vendor-key\nexport OPENAI_BASE_URL=https://vendor.invalid/v1\nexport CODEX_HOME=/retired-private-codex\n', { mode: 0o600 });
  const results = {};
  for (const flags of ['-lc', '-c']) {
    const name = `hive-router-shell-${randomUUID()}`;
    // This workspace delegates a threaded cgroup; use finite process data/stack
    // limits, as the other local Docker experiments do, instead of memory.max.
    const args = ['run', '--rm', '--pull', 'never', '--name', name, '--user', `${process.getuid()}:${process.getgid()}`, '--network', 'none', '--read-only', '--cgroup-parent', '/', '--ulimit', 'data=1610612736:1610612736', '--ulimit', 'stack=16777216:16777216', '--ulimit', 'core=0:0', '--pids-limit', '16', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--mount', `type=bind,src=${home},dst=/private-home,readonly`, '--env', 'HOME=/private-home', '--env', 'OPENAI_API_KEY=synthetic-router-task', '--env', 'OPENAI_BASE_URL=https://router.invalid/v1', '--env', 'CODEX_HOME=/private-codex', 'alpine:3.22', 'sh', flags, script];
    try {
      await run('docker', args, { timeout: 15_000, maxBuffer: 64 * 1024 });
      results[flags] = 'admitted environment preserved';
    } catch (error) {
      if (error.code !== 1) throw error;
      results[flags] = 'admitted environment replaced';
    } finally {
      await run('docker', ['rm', '-f', name], { timeout: 5000, maxBuffer: 64 * 1024 }).catch(() => {});
    }
  }
  assert.equal(results['-lc'], 'admitted environment replaced');
  assert.equal(results['-c'], 'admitted environment preserved');
  console.log(JSON.stringify({ scope: 'actual isolated shell startup; no native CLI or inference', results }));
} finally {
  await rm(home, { recursive: true, force: true });
}
