// Resume an externally interrupted default run without repeating completed files.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import process from 'node:process';
import console from 'node:console';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const previous = await fs.readFile(process.argv[2], 'utf8');
assert.ok(!previous.includes('Failed test files:'), 'Do not resume past a reported failure.');
const starts = [...previous.matchAll(/^\[(\d+)\/(\d+)\] (tests\/[^\n]+)$/gmu)];
assert.ok(starts.length);
const last = starts.at(-1)[3];
const { stdout } = await execute(process.execPath, ['scripts/run-tests.mjs', '--suite', 'default', '--list'], { maxBuffer: 256 * 1024 });
const tests = stdout.trim().split('\n');
const offset = tests.indexOf(last);
assert.ok(offset >= 0, 'The interrupted test must still be in the current selection.');
console.log(`Resuming at ${last}; ${tests.length - offset} files remain.`);
for (const [index, file] of tests.slice(offset).entries()) {
  console.log(`\n[${index + 1}/${tests.length - offset}] ${file}`);
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file], { stdio: 'inherit', env: process.env });
    child.once('error', reject);
    child.once('close', (status, signal) => resolve(signal ? 1 : status));
  });
  assert.equal(code, 0, `Failed: ${file}`);
}
console.log(`All ${tests.length - offset} remaining test files passed.`);
