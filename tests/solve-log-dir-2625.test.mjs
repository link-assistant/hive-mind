/**
 * Regression coverage for issue #2625 (Formal AI Draft runs 37204604042 …
 * 37628867214, step "Upload the session log").
 *
 * The workflow runs `solve … --log-dir /home/box/logs` with that directory
 * bind-mounted from the runner, then uploads it as an artifact. solve parsed
 * `--log-dir` but never used it: the session log was created in the working
 * directory before argv was parsed and was never moved, so every run wrote
 * `/home/box/solve-*.log` inside the container and the upload step warned
 * "No files were found with the provided path". The draft that failed before
 * opening a pull request — the case the artifact exists for — left no log.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2625
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { moveLogFileToLogDir } from '../src/solve.log-dir.lib.mjs';

const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solve-log-dir-'));
  const cwdLog = path.join(root, 'solve-2026-10-07T13-47-51-515Z.log');
  fs.writeFileSync(cwdLog, '# Solve.mjs Log\n\n🚀 solve v1\n');
  let current = cwdLog;
  const logged = [];
  return {
    root,
    cwdLog,
    deps: { getLogFile: () => current, setLogFile: file => (current = file), log: async message => logged.push(message) },
    current: () => current,
    logged,
  };
};

test('the session log moves into --log-dir with everything written so far', async () => {
  const { root, cwdLog, deps, current, logged } = fixture();
  const logDir = path.join(root, 'logs');
  const moved = await moveLogFileToLogDir(logDir, deps);
  assert.equal(moved, path.join(logDir, path.basename(cwdLog)));
  assert.equal(current(), moved, 'later writes go to the new file');
  assert.equal(fs.readFileSync(moved, 'utf8'), '# Solve.mjs Log\n\n🚀 solve v1\n');
  assert.equal(fs.existsSync(cwdLog), false, 'no stray copy is left in the working directory');
  assert.match(logged.join('\n'), /--log-dir/);
});

test('without --log-dir, or when it is already the log directory, nothing moves', async () => {
  const { root, cwdLog, deps, current } = fixture();
  assert.equal(await moveLogFileToLogDir(undefined, deps), cwdLog);
  assert.equal(await moveLogFileToLogDir('', deps), cwdLog);
  assert.equal(await moveLogFileToLogDir(root, deps), cwdLog);
  assert.equal(current(), cwdLog);
  assert.ok(fs.existsSync(cwdLog));
});

test('a --log-dir that cannot be used keeps the original log and says why', async () => {
  const { root, cwdLog, deps, current, logged } = fixture();
  const blocker = path.join(root, 'not-a-directory');
  fs.writeFileSync(blocker, '');
  assert.equal(await moveLogFileToLogDir(blocker, deps), cwdLog);
  assert.equal(current(), cwdLog);
  assert.ok(fs.existsSync(cwdLog));
  assert.match(logged.join('\n'), /Could not move the session log/);
});

test('solve applies --log-dir right after parsing its arguments, before the path is reported', () => {
  const solve = fs.readFileSync(new URL('../src/solve.mjs', import.meta.url), 'utf8');
  const parsed = solve.indexOf('argv = await parseArguments(yargs, hideBin);');
  const moved = solve.indexOf('.moveLogFileToLogDir(argv.logDir, { getLogFile, setLogFile, log })');
  const reported = solve.indexOf('const absoluteLogPath = path.resolve(getLogFile());');
  assert.ok(parsed > 0 && moved > parsed && reported > moved, 'parse → move → report');
});
