/**
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

function probe(scenario) {
  return JSON.parse(execFileSync(process.execPath, ['--experimental-vm-modules', 'experiments/issue-2324/matrix-schedule-probe.mjs', scenario], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

for (const scenario of ['skipped', 'missing', 'failed']) {
  test(`a successful workflow with ${scenario} matrix rows does not suppress the daily test`, { timeout: 10_000 }, () => {
    const result = probe(scenario);
    assert.match(result.output, /should_run=true/);
    assert.equal(result.metadata.previousTag, 'v0.351.0');
    assert.equal(result.lastDownload, '1');
  });
}

test('a successful run with every model row passing suppresses the already tested tag', { timeout: 10_000 }, () => {
  const result = probe('complete');
  assert.match(result.output, /should_run=false/);
  assert.equal(result.metadata.previousTag, 'v0.352.1');
  assert.equal(result.lastDownload, '2');
});

// Issue #2923: run 37992515531 went green with every row skipped after release run
// 37983302098 failed, but only logged "last successful matrix not recorded".
test('a matrix skipped after a failed release names the release run as the reason', { timeout: 10_000 }, () => {
  const result = probe('workflow_run-failure');
  assert.match(result.output, /should_run=false/);
  assert.deepEqual(result.logs, ['::notice title=E2E matrix skipped::Matrix skips: latest Formal AI v0.352.1; Checks and release run 37983302098 concluded failure on main']);
});

test('a matrix after a successful release runs and says why', { timeout: 10_000 }, () => {
  const result = probe('workflow_run-success');
  assert.match(result.output, /should_run=true/);
  assert.deepEqual(result.logs, ['Matrix runs: latest Formal AI v0.352.1; Checks and release run 37983302098 concluded success on main']);
});
