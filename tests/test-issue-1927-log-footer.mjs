#!/usr/bin/env node
/**
 * Unit tests for the execution-log footer reader (issue #1927).
 *
 * start-command appends an authoritative footer to every execution log when the
 * wrapped command exits:
 *
 *     ==================================================
 *     Finished: 2026-06-14 19:10:49.822
 *     Exit Code: 137
 *
 * Its `enrichDetachedStatus` can later flip a completed `executed/137` record
 * back to `executing` (nulling the exit code) when a lingering shell keeps the
 * screen session alive — which is exactly how the OOM kill went unreported. The
 * footer is written from the command's own close handler, so its presence proves
 * the command terminated regardless of what `--status` claims. These tests pin
 * down that we parse it correctly (last-footer-wins, signal codes, tail reads)
 * and never throw on a missing/partial log.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1927
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { parseSessionExitFooter, readSessionExitFromLog, checkBackendSessionAlive } from '../src/isolation-runner.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #1927: execution-log footer parsing');
console.log('='.repeat(60));

const SEP = '='.repeat(50);

// --- parseSessionExitFooter ---------------------------------------------------
const killedFooter = `some command output line\nmore output\n${SEP}\nFinished: 2026-06-14 19:10:49.822\nExit Code: 137\n`;
const killed = parseSessionExitFooter(killedFooter);
assert(killed.finished === true, 'parseSessionExitFooter detects a finished footer');
assert(killed.exitCode === 137, 'parseSessionExitFooter reads exit code 137 (SIGKILL/OOM)');
assert(killed.endTime === '2026-06-14 19:10:49.822', 'parseSessionExitFooter captures the Finished timestamp');

const successFooter = `output\n${SEP}\nFinished: 2026-06-14 20:00:00.000\nExit Code: 0\n`;
assert(parseSessionExitFooter(successFooter).exitCode === 0, 'parseSessionExitFooter reads exit code 0');

// CRLF line endings (logs captured on or copied from Windows)
const crlfFooter = `output\r\n${SEP}\r\nFinished: 2026-06-14 21:00:00.000\r\nExit Code: 143\r\n`;
const crlf = parseSessionExitFooter(crlfFooter);
assert(crlf.finished && crlf.exitCode === 143, 'parseSessionExitFooter handles CRLF line endings (exit 143)');

// Last footer wins when a log was appended to across re-runs.
const twoFooters = `${SEP}\nFinished: 2026-06-14 10:00:00.000\nExit Code: 0\n...rerun...\n${SEP}\nFinished: 2026-06-14 11:00:00.000\nExit Code: 137\n`;
assert(parseSessionExitFooter(twoFooters).exitCode === 137, 'parseSessionExitFooter returns the LAST footer when several are present');

// A command that merely prints "Exit Code: N" mid-stream is not the footer.
const fakeFooter = `the script logged Exit Code: 99 to stdout\nbut never finished\n`;
assert(parseSessionExitFooter(fakeFooter).finished === false, 'parseSessionExitFooter ignores a mid-stream "Exit Code:" without the = separator');

// Negative exit codes (start-command's -1 sentinel) parse as a number.
const negFooter = `${SEP}\nFinished: 2026-06-14 12:00:00.000\nExit Code: -1\n`;
assert(parseSessionExitFooter(negFooter).exitCode === -1, 'parseSessionExitFooter parses the -1 sentinel');

// Defensive: empty / nullish input never throws.
assert(parseSessionExitFooter('').finished === false, 'parseSessionExitFooter("") is not finished');
assert(parseSessionExitFooter(null).finished === false, 'parseSessionExitFooter(null) is not finished');
assert(parseSessionExitFooter(undefined).finished === false, 'parseSessionExitFooter(undefined) is not finished');

// --- readSessionExitFromLog (real filesystem, tail read) ----------------------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-1927-footer-'));
try {
  const logPath = path.join(tmpDir, 'session.log');
  fs.writeFileSync(logPath, killedFooter);
  const fromLog = readSessionExitFromLog(logPath);
  assert(fromLog.finished && fromLog.exitCode === 137, 'readSessionExitFromLog reads exit 137 from a real file');

  // A large log: the footer must still be found via the tail read.
  const bigLogPath = path.join(tmpDir, 'big.log');
  fs.writeFileSync(bigLogPath, 'x'.repeat(200000) + '\n' + successFooter);
  const fromBig = readSessionExitFromLog(bigLogPath);
  assert(fromBig.finished && fromBig.exitCode === 0, 'readSessionExitFromLog finds the footer in the tail of a 200KB log');

  // tailBytes too small to include the footer → not finished (proves it is a tail read).
  const tiny = readSessionExitFromLog(bigLogPath, { tailBytes: 8 });
  assert(tiny.finished === false, 'readSessionExitFromLog with a tiny tailBytes does not see a far-away footer');

  // Missing file → never throws, reports not finished.
  const missing = readSessionExitFromLog(path.join(tmpDir, 'does-not-exist.log'));
  assert(missing.finished === false && missing.exitCode === null, 'readSessionExitFromLog on a missing file returns {finished:false}');

  // Empty file → not finished.
  const emptyPath = path.join(tmpDir, 'empty.log');
  fs.writeFileSync(emptyPath, '');
  assert(readSessionExitFromLog(emptyPath).finished === false, 'readSessionExitFromLog on an empty file returns {finished:false}');

  // Null path → not finished.
  assert(readSessionExitFromLog(null).finished === false, 'readSessionExitFromLog(null) returns {finished:false}');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// --- checkBackendSessionAlive dispatch ---------------------------------------
// An unknown backend yields null ("no signal"), so a kill is never inferred from
// an indeterminate probe.
const unknownBackend = await checkBackendSessionAlive('some-id', 'not-a-real-backend', false);
assert(unknownBackend === null, 'checkBackendSessionAlive returns null for an unknown backend (no false kill)');

printSummary();

if (getFailCount() > 0) {
  process.exit(1);
}
