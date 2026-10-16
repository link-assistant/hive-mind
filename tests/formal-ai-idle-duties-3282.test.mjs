#!/usr/bin/env node

/**
 * Issue #3282: Formal AI is downloaded when needed and offloaded when unused,
 * whichever process launched it. The idle duties used to run only in the
 * Telegram bot, so a host driven by `hive` or `solve` kept an unused image
 * forever; a host that never ran Formal AI must not call Docker for it.
 *
 * @hive-mind-test-suite default
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runFormalAiIdleDuties } from '../src/formal-ai-maintenance.lib.mjs';
import { resolveFormalAiSidecarStatePath } from '../src/formal-ai-sidecar.lib.mjs';
import { finalizeSolveProcess } from '../src/solve.finalize.lib.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const tempEnv = () => ({ HIVE_MIND_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'formal-ai-idle-')), HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'formal-ai-idle-home-')) });

test('a host where Formal AI never ran is skipped without touching Docker', async () => {
  const env = tempEnv();
  let ticks = 0;
  assert.equal(await runFormalAiIdleDuties({ env, runTick: async () => ticks++ }), null);
  assert.equal(ticks, 0);
});

test('a host that ran Formal AI stops and unloads it, but never updates images or CLIs', async () => {
  const env = tempEnv();
  const statePath = resolveFormalAiSidecarStatePath(env);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify({ leases: [] }));
  const calls = [];
  const result = await runFormalAiIdleDuties({
    env,
    run: async () => {
      throw new Error('docker is not used by the stubbed steps');
    },
    runTick: async options => {
      const { runFormalAiMaintenanceTick } = await import('../src/formal-ai-maintenance.lib.mjs');
      return runFormalAiMaintenanceTick({ ...options, stopIdle: async () => (calls.push('stop-idle'), { leaseCount: 0, stopped: true }), unloadIdle: async () => (calls.push('unload-idle'), { status: 'unloaded' }) });
    },
  });
  assert.deepEqual(calls, ['stop-idle', 'unload-idle']);
  assert.equal(result.formalAi, null);
  assert.equal(result.agenticClis, null);
  assert.deepEqual(result.errors, []);
});

test('solve runs the idle duties when it finishes, and their failure cannot change the exit', async () => {
  let idleRuns = 0;
  const exits = [];
  await finalizeSolveProcess({
    tempDir: null,
    argv: { verbose: false },
    limitReached: false,
    path,
    getLogFile: () => null,
    log: async () => {},
    closeSentry: async () => {},
    logActiveHandles: async () => {},
    cleanupTempDirectory: async () => {},
    safeExit: async (code, reason) => exits.push({ code, reason }),
    formalAiIdleDuties: async () => {
      idleRuns++;
      throw new Error('docker unavailable');
    },
  });
  assert.equal(idleRuns, 1);
  assert.equal(exits.at(-1).code, 0);
});

test('hive runs the idle duties for as long as it monitors', () => {
  const hive = fs.readFileSync(path.join(repositoryRoot, 'src', 'hive.mjs'), 'utf8');
  assert.match(hive, /startFormalAiMaintenance\(\{ log, verbose: argv\.verbose, runTick: runFormalAiIdleDuties \}\)/);
  assert.match(hive, /formalAiIdleMaintenance\.stop\(\)/);
});
