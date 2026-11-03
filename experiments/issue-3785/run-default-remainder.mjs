// Continue an interrupted fail-fast default run. The original runner advances
// its file counter only after the preceding child exits successfully. Re-run
// the final started file, and run any newly discovered files as well.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const previousLog = process.argv[2];
assert.ok(previousLog, 'Provide the interrupted default-suite log.');
assert.ok(statSync(previousLog).size < 8 * 1024 * 1024, 'Keep the input log bounded.');
const text = readFileSync(previousLog, 'utf8');
assert.match(text, /Running \d+ default test file\(s\)\.\.\./u);
assert.ok(!/Stopping after first failure|Failed test files:/u.test(text), 'Do not resume a failed run as successful.');
const started = [...text.matchAll(/^\[(\d+)\/(\d+)\] (tests\/[^\r\n]+)$/gmu)];
assert.ok(started.length > 0);
for (const [index, match] of started.entries()) {
  assert.equal(Number(match[1]), index + 1, 'Expected a consecutive fail-fast run.');
  assert.equal(match[2], started[0][2]);
}
const completed = new Set(started.slice(0, -1).map(match => match[3]));
const selected = execFileSync(process.execPath, ['scripts/run-tests.mjs', '--suite', 'default', '--list'], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
  .trim()
  .split('\n');
for (const file of completed) assert.ok(selected.includes(file), 'Previously completed tests must remain selected.');
const pending = selected.filter(file => !completed.has(file));
console.log(`Original runner advanced after ${completed.size} successful files; running ${pending.length} remaining/new files of ${selected.length}.`);
for (const [index, file] of pending.entries()) {
  console.log(`\n[remainder ${index + 1}/${pending.length}] ${file}`);
  const result = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  if (result.error || result.signal || result.status !== 0) {
    console.error(`Remaining default test failed: ${file}`);
    process.exit(1);
  }
}
console.log(`All ${selected.length} selected default files passed across the interrupted prefix and this completed remainder.`);
