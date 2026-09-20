#!/usr/bin/env node
/**
 * Reproduces the `enrichDetachedStatus` regression in link-foundation/start.
 *
 * The three functions below are copied VERBATIM from start's
 * `js/src/lib/status-formatter.js` (only `execSync`/`fs` are needed, so the
 * module's two sibling imports are dropped). We then feed in the exact state the
 * OOM scenario produces — a record already marked `executed` with `exitCode: 137`
 * and a log whose footer says `Exit Code: 137` — while a real `screen` session of
 * the same name still lingers. `enrichDetachedStatus` flips the completed record
 * back to `executing` and NULLS the exit code, which is how a SIGKILLed `/solve`
 * was reported to the Telegram bot as still running (hive-mind issue #1927).
 *
 * Run: node experiments/upstream-start-enrichDetachedStatus-flip.mjs
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---- VERBATIM from start/js/src/lib/status-formatter.js -----------------------
function isDetachedSessionAlive(record) {
  const opts = record.options || {};
  const sessionName = opts.sessionName;
  const isolationMode = opts.isolationMode;
  const isolated = opts.isolated;
  if (!sessionName || isolationMode !== 'detached') {
    return null;
  }
  try {
    switch (isolated) {
      case 'screen': {
        const output = execSync('screen -ls', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        return output.includes(sessionName);
      }
      default:
        return null;
    }
  } catch {
    return false;
  }
}

function readExitCodeFromLog(logPath) {
  if (!logPath) return null;
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const matches = [...content.matchAll(/Exit Code:\s*(-?\d+)/g)];
    if (matches.length === 0) return null;
    return parseInt(matches[matches.length - 1][1], 10);
  } catch {
    return null;
  }
}

function enrichDetachedStatus(record) {
  const alive = isDetachedSessionAlive(record);
  if (alive === null) return record;
  const enriched = Object.create(Object.getPrototypeOf(record));
  Object.assign(enriched, record);
  if (alive && enriched.status === 'executed') {
    enriched.status = 'executing';
    enriched.exitCode = null;
    enriched.endTime = null;
  } else if (!alive && enriched.status === 'executing') {
    enriched.status = 'executed';
    if (enriched.exitCode === null || enriched.exitCode === undefined) {
      enriched.exitCode = readExitCodeFromLog(enriched.logPath) ?? -1;
    }
    if (!enriched.endTime) {
      enriched.endTime = new Date().toISOString();
    }
  }
  return enriched;
}
// ---- end verbatim -------------------------------------------------------------

const SESSION = 'repro-1927-' + process.pid;
const logPath = path.join(os.tmpdir(), `${SESSION}.log`);

// A log footer exactly like start-command writes when the command is SIGKILLed.
fs.writeFileSync(logPath, ['=== Start Command Log ===', `Execution ID: ${SESSION}`, '', 'Killed', '', '='.repeat(50), 'Finished: 2026-06-14 19:10:49.822', 'Exit Code: 137', ''].join('\n'));

// A real screen session of the same name that OUTLIVES the (already-dead) command
// — the lingering-shell condition. `sleep` stands in for the leftover shell.
execSync(`screen -dmS ${SESSION} sh -c 'sleep 30'`);
try {
  const lsHasIt = execSync('screen -ls', { encoding: 'utf8' }).includes(SESSION);

  // The record start-command already has after the kill: terminal + exit 137.
  const record = {
    status: 'executed',
    exitCode: 137,
    endTime: '2026-06-14T19:10:49.822Z',
    logPath,
    options: { sessionName: SESSION, isolationMode: 'detached', isolated: 'screen' },
  };

  const out = enrichDetachedStatus(record);

  console.log('screen -ls lists the session name :', lsHasIt);
  console.log('log footer exit code              :', readExitCodeFromLog(logPath));
  console.log('');
  console.log('BEFORE enrichDetachedStatus       : status=%s exitCode=%s', record.status, record.exitCode);
  console.log('AFTER  enrichDetachedStatus       : status=%s exitCode=%s', out.status, out.exitCode);
  console.log('');
  const bug = out.status === 'executing' && out.exitCode === null;
  console.log(bug ? '❌ BUG REPRODUCED: a completed exit-137 record was flipped back to "executing" and its exit code erased.' : '✅ no flip (bug not reproduced in this environment).');
  process.exitCode = bug ? 0 : 2;
} finally {
  try {
    execSync(`screen -S ${SESSION} -X quit`, { stdio: 'ignore' });
  } catch {}
  try {
    fs.unlinkSync(logPath);
  } catch {}
}
