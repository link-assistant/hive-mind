// Resume an interrupted default run, or retry from an explicitly selected file
// in saved `scripts/run-tests.mjs --list` output. Never skip the interrupted file.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const previous = await fs.readFile(process.argv[2], 'utf8');
let tests;
let last;
if (process.argv[3]) {
  tests = previous.trim().split('\n');
  assert.ok(tests.every(file => /^tests\/[A-Za-z0-9_./-]+\.(?:mjs|test\.js)$/u.test(file)));
  last = process.argv[3];
} else {
  assert.ok(!previous.includes('Failed test files:'), 'Do not resume past a reported failure.');
  const starts = [...previous.matchAll(/^\[(\d+)\/(\d+)\] (tests\/[^\n]+)$/gmu)];
  assert.ok(starts.length);
  last = starts.at(-1)[3];
  const { stdout } = await execute(process.execPath, ['scripts/run-tests.mjs', '--suite', 'default', '--list'], { maxBuffer: 256 * 1024 });
  tests = stdout.trim().split('\n');
}
const offset = tests.indexOf(last);
assert.ok(offset >= 0, 'The interrupted test must still be in the current selection.');
console.log(`Resuming at ${last}; ${tests.length - offset} files remain.`);
const env = { ...process.env };
// A global old-space flag overrides worker_threads.resourceLimits, invalidating
// containment tests. Explicit retry mode lets their own worker limits apply.
if (process.argv[3]) delete env.NODE_OPTIONS;
for (const [index, file] of tests.slice(offset).entries()) {
  console.log(`\n[${index + offset + 1}/${tests.length}] ${file}`);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], { stdio: 'inherit', env });
    child.once('error', reject);
    child.once('close', (status, signal) => resolve(signal ? 1 : status));
  });
  assert.equal(code, 0, `Failed: ${file}`);
}
console.log(`All ${tests.length - offset} remaining test files passed.`);
