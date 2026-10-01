#!/usr/bin/env node

/**
 * Issue #2395: with `--verbose`, every finished AI session reports processes
 * that are still running in its work directory, so a process that outlived a
 * stopped session (the suspected author of the 20:10:37 rewrite of the
 * konard/p-vs-np#623 description) shows up in the log next time.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2395
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findProcessesInDirectory, logProcessesSurvivingSession } from '../src/session-survivors.lib.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const test = async (description, fn) => {
  try {
    await fn();
    console.log(`  PASS: ${description}`);
    passed++;
  } catch (error) {
    console.log(`  FAIL: ${description}`);
    console.log(`      ${error.stack || error.message}`);
    failed++;
  }
};

console.log('Issue #2395: report processes that outlive an AI session (--verbose)\n');

const workDir = await mkdtemp(join(tmpdir(), 'hive-mind-2395-'));
const subDir = join(workDir, 'nested');
await mkdir(subDir);

if (process.platform === 'linux') {
  await test('a detached process left in the work directory is found with its command line', async () => {
    // Like a command Codex runs in its own session: not in the killed process group.
    const child = spawn('sleep', ['30'], { cwd: subDir, detached: true, stdio: 'ignore' });
    try {
      await new Promise(resolve => setTimeout(resolve, 100));
      const found = await findProcessesInDirectory({ dir: workDir });
      const leftover = found.find(entry => entry.pid === child.pid);
      assert.ok(leftover, `pid ${child.pid} found in ${JSON.stringify(found)}`);
      assert.equal(leftover.cwd, subDir);
      assert.equal(leftover.command, 'sleep 30');
    } finally {
      child.kill('SIGKILL');
    }
  });

  await test('this process and processes elsewhere are not reported', async () => {
    const found = await findProcessesInDirectory({ dir: workDir, excludePids: [process.pid] });
    assert.equal(
      found.some(entry => entry.pid === process.pid),
      false
    );
    const other = await findProcessesInDirectory({ dir: `${workDir}-other` });
    assert.deepEqual(other, []);
  });
}

await test('nothing is listed without /proc or without a directory', async () => {
  assert.deepEqual(await findProcessesInDirectory({ dir: workDir, procRoot: join(workDir, 'no-proc') }), []);
  assert.deepEqual(await findProcessesInDirectory({ dir: null }), []);
});

await test('the check only runs with --verbose', async () => {
  const messages = [];
  const log = async (message, options) => messages.push({ message, options });
  const find = async () => assert.fail('must not scan without --verbose');
  assert.deepEqual(await logProcessesSurvivingSession({ tempDir: workDir, argv: {}, log, find }), []);
  assert.equal(messages.length, 0);
});

await test('leftover processes are logged as warnings, one line each', async () => {
  const messages = [];
  const log = async (message, options) => messages.push({ message, options });
  const survivors = [{ pid: 4242, cwd: workDir, command: "/bin/bash -lc 'gh run watch 36623953752 --repo konard/p-vs-np --exit-status'" }];
  const result = await logProcessesSurvivingSession({ tempDir: workDir, argv: { verbose: true }, log, find: async () => survivors });
  assert.deepEqual(result, survivors);
  assert.match(messages[0].message, /1 process\(es\) still running/);
  assert.match(messages[1].message, /pid 4242: .*gh run watch/);
  assert.equal(messages[1].options.level, 'warning');
});

await test('a clean exit is logged in verbose mode and a scan error never escapes', async () => {
  const messages = [];
  const log = async message => messages.push(message);
  await logProcessesSurvivingSession({ tempDir: workDir, argv: { verbose: true }, log, find: async () => [] });
  assert.match(messages.pop(), /No processes left running/);
  await logProcessesSurvivingSession({
    tempDir: workDir,
    argv: { verbose: true },
    log,
    find: async () => {
      throw new Error('EACCES');
    },
  });
  assert.match(messages.pop(), /Could not list processes.*EACCES/);
});

await test('every finished session is checked, in the first session and in restart iterations', async () => {
  const sessionResult = await readFile(join(repoRoot, 'src', 'session-result.lib.mjs'), 'utf8');
  assert.match(sessionResult, /await logProcessesSurvivingSession\(\{ tempDir, argv, log \}\)/);
  for (const file of ['solve.mjs', 'solve.restart-shared.lib.mjs']) {
    const source = await readFile(join(repoRoot, 'src', file), 'utf8');
    assert.match(source, /classifySessionResult\(\{ toolResult, argv, owner, repo, prNumber, \$, log, tempDir \}\)/, file);
  }
});

await rm(workDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
