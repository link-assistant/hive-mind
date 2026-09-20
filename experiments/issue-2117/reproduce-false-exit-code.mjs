#!/usr/bin/env node
/**
 * Issue #2117 — reproduce the false "exit code: 1" reported for a session that
 * actually finished successfully.
 *
 * Root cause (upstream, start-command <= 0.30.3):
 * `src/lib/status-formatter.js#readExitCodeFromLog()` scans the WHOLE execution
 * log with an unanchored `/Exit Code:\s*(-?\d+)/g` and takes the last match as
 * the session's terminal exit code. Any text the wrapped command prints that
 * merely contains the substring "Exit Code: N" is therefore indistinguishable
 * from the real footer that start-command appends at the very end of the log:
 *
 *     ==================================================
 *     Finished: 2026-07-30 06:38:21.188
 *     Exit Code: 0
 *
 * In the incident the containerized Codex agent printed the tail of an unrelated
 * 2026-07-28 start-command log (an `rg -n` dump, so the lines carried `41-` /
 * `42-` line-number prefixes) into its own log at 06:17:26. From that moment on,
 * `$ --status` believed the session's exit code was 1 — 21 minutes before the
 * command even finished. When the container stopped (and before the detached
 * docker watcher appended the real footer at 06:38:21.188), `enrichDetachedStatus`
 * flipped the record to `executed` and stamped it with that fabricated 1.
 *
 * Hive Mind's Telegram monitor trusted the terminal status/exit code verbatim and
 * announced "❌ Work session failed (exit code: 1)" for a run that merged its PR
 * and exited 0.
 *
 * This script reproduces the defect end to end against the REAL, installed `$`
 * CLI (no mocks) and contrasts it with Hive Mind's own anchored footer parser,
 * which is immune to the same input.
 *
 * Usage: node experiments/issue-2117/reproduce-false-exit-code.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2117
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { parseSessionExitFooter } from '../../src/isolation-runner.lib.mjs';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2117-'));
const appFolder = path.join(tmpRoot, 'start-command');
const logPath = path.join(tmpRoot, 'session.log');
const uuid = '00000000-0000-4000-8000-000000002117';
const sessionName = 'issue-2117-container-that-does-not-exist';

// The log as it looked while the command was STILL RUNNING: the agent has echoed
// the tail of an unrelated execution log (note the `41-`/`42-` line prefixes that
// `rg -n` adds), and the real footer has not been written yet.
const runningLog = ['=== Start Command Log ===', `Execution ID: ${uuid}`, 'Command: solve https://github.com/link-assistant/use-m/issues/68', 'Environment: docker', 'Mode: detached', `Session: ${sessionName}`, '='.repeat(50), '', 'Command started in detached docker container.', '', '{"type":"item.completed","item":{"aggregated_output":"1-=== Start Command Log ===\\n40-==================================================\\n41-Finished: 2026-07-28 20:04:52.316\\n42-Exit Code: 1\\n","exit_code":0,"status":"completed"}}', '', '✅ Pull request merged successfully', ''].join('\n');

fs.writeFileSync(logPath, runningLog, 'utf8');

const record = {
  uuid,
  pid: 4242,
  status: 'executing',
  exitCode: null,
  command: 'solve https://github.com/link-assistant/use-m/issues/68',
  logPath,
  startTime: '2026-07-30T06:14:21.348Z',
  endTime: null,
  workingDirectory: tmpRoot,
  shell: '/bin/sh',
  platform: 'linux',
  options: {
    isolated: 'docker',
    isolationMode: 'detached',
    sessionName,
  },
};

// Resolve the globally installed start-command package from the `$` binary so
// this runs against the exact CLI Hive Mind uses in production.
const dollarBin = fs.realpathSync(execFileSync('which', ['$'], { encoding: 'utf8' }).trim());
const startCommandRoot = path.resolve(path.dirname(dollarBin), '..', '..');
const { ExecutionStore, ExecutionRecord } = await import(path.join(startCommandRoot, 'src/lib/execution-store.js'));
const store = new ExecutionStore({ appFolder });
store.save(new ExecutionRecord(record));

const statusOutput = execFileSync('$', ['--status', uuid], {
  encoding: 'utf8',
  env: { ...process.env, START_APP_FOLDER: appFolder },
});

console.log('--- `$ --status` while the command is still running ---');
console.log(statusOutput.trim());

const reportedStatus = /^\s*status\s+(\S+)/m.exec(statusOutput)?.[1] ?? null;
const reportedExit = /^\s*exitCode\s+(-?\d+)/m.exec(statusOutput)?.[1] ?? null;
const hiveFooter = parseSessionExitFooter(fs.readFileSync(logPath, 'utf8'));

console.log('\n--- interpretation ---');
console.log(`$ --status                     : status=${reportedStatus} exitCode=${reportedExit}`);
console.log(`hive-mind parseSessionExitFooter: finished=${hiveFooter.finished} exitCode=${hiveFooter.exitCode}`);

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? '  OK  ' : '  BUG '} ${label}`);
  if (!ok) failures++;
};

console.log('\n--- assertions ---');
check('`$ --status` fabricated a terminal exit code from command output (upstream defect)', reportedExit === '1');
check('`$ --status` marked a still-running session as terminal (upstream defect)', reportedStatus === 'executed');
check("hive-mind's anchored footer parser is NOT fooled by the same log", hiveFooter.finished === false);

// Now append the REAL footer, exactly as the detached docker watcher does when
// the container exits, and re-read both parsers.
fs.appendFileSync(logPath, `\n${'='.repeat(50)}\nFinished: 2026-07-30 06:38:21.188\nExit Code: 0\n`, 'utf8');

const statusAfter = execFileSync('$', ['--status', uuid], {
  encoding: 'utf8',
  env: { ...process.env, START_APP_FOLDER: appFolder },
});
const exitAfter = /^\s*exitCode\s+(-?\d+)/m.exec(statusAfter)?.[1] ?? null;
const footerAfter = parseSessionExitFooter(fs.readFileSync(logPath, 'utf8'));

console.log('\n--- after the real footer is written ---');
console.log(`$ --status                     : exitCode=${exitAfter}`);
console.log(`hive-mind parseSessionExitFooter: finished=${footerAfter.finished} exitCode=${footerAfter.exitCode}`);
check('once the real footer exists both agree on exit 0', exitAfter === '0' && footerAfter.finished === true && footerAfter.exitCode === 0);

console.log(`\nTemp files: ${tmpRoot}`);
console.log(failures === 0 ? '\nReproduced as expected.' : `\n${failures} expectation(s) did not hold.`);
process.exit(failures === 0 ? 0 : 1);
