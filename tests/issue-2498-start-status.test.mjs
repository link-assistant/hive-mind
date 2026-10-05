/**
 * @hive-mind-test-suite default
 * start-command 0.35.2 retains per-container OOM counters after the task dies.
 * Losing those fields hides child OOM events and leaves the bot's cgroup as the
 * only counter source. Exercise the parser and the real monitor entry point.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSessionStatusOutput, parseSessionListOutput } from '../src/isolation-runner.parsers.lib.mjs';
import { getIsolationSessionStateForTests, __setIsolationRunnerForTests } from '../src/session-monitor.lib.mjs';
import { isExecutingSessionStatus, isTerminalSessionStatus } from '../src/session-status.lib.mjs';
import { describeKillCause, buildKillDiagnosticsSection } from '../src/session-kill-diagnostics.lib.mjs';

const counters = { limitBytes: 3_135_373_312, peakBytes: 3_100_000_000, oomEvents: 2, oomKills: 5 };

test('status and list preserve the watcher counters; missing and malformed counters remain unknown', () => {
  const record = { uuid: 'task', status: 'executed', exitCode: 137, cgroupMemory: counters };
  assert.deepEqual(parseSessionStatusOutput(JSON.stringify(record)).cgroupMemory, counters);
  assert.deepEqual(parseSessionListOutput(JSON.stringify([record]))[0].cgroupMemory, counters);
  for (const cgroupMemory of [undefined, null, {}, { oomKills: -1 }, { oomKills: 'not-a-number' }]) {
    assert.equal(parseSessionStatusOutput(JSON.stringify({ ...record, cgroupMemory })).cgroupMemory, null);
  }
  assert.equal(parseSessionStatusOutput('').cgroupMemory, null);
  const unlimited = { limitBytes: null, peakBytes: null, oomEvents: 0, oomKills: 0 };
  assert.deepEqual(parseSessionStatusOutput(JSON.stringify({ ...record, cgroupMemory: unlimited })).cgroupMemory, unlimited);
});

test('links-notation counters come from the cgroupMemory block, not recoveryHistory', () => {
  const output = 'task\n  status executed\n  exitCode 137\n  cgroupMemory\n    limitBytes 3135373312\n    peakBytes 3100000000\n    oomEvents 2\n    oomKills 5\n  recoveryHistory\n    oomKills 99\n';
  assert.deepEqual(parseSessionStatusOutput(output).cgroupMemory, counters);
  assert.equal(parseSessionStatusOutput('task\n  status executed\n  recoveryHistory\n    oomKills 99\n').cgroupMemory, null);
});

test('the monitor uses counters without OOMKilled, while footer and liveness still win', async () => {
  __setIsolationRunnerForTests({ isExecutingSessionStatus, isTerminalSessionStatus });
  try {
    for (const [exitCode, expectedStatus] of [
      [0, 'executed'],
      [1, 'failed'],
      [137, 'oom-killed'],
      [143, 'terminated'],
    ]) {
      const info = { isolationBackend: 'docker', sessionId: 'task' };
      const state = await getIsolationSessionStateForTests('task', info, {
        statusProvider: async () => ({ exists: true, status: 'executed', exitCode, oomKilled: false, cgroupMemory: counters }),
        backendAlive: async () => false,
      });
      assert.equal(state.status, expectedStatus, `exit ${exitCode}`);
      assert.equal(state.exitCode, exitCode);
      assert.ok(info.oomEventObservedAt, `exit ${exitCode} retains the child OOM observation`);
    }
    const liveInfo = { isolationBackend: 'docker', sessionId: 'live' };
    const live = await getIsolationSessionStateForTests('live', liveInfo, {
      statusProvider: async () => ({ exists: true, status: 'executed', exitCode: 137, cgroupMemory: counters }),
      backendAlive: async () => true,
    });
    assert.equal(live.running, true);
    assert.ok(liveInfo.oomEventObservedAt);
    const footer = await getIsolationSessionStateForTests(
      'task',
      { isolationBackend: 'docker' },
      {
        statusProvider: async () => ({ exists: true, status: 'executed', exitCode: 137, cgroupMemory: counters, logPath: '/task.log' }),
        exitFromLog: () => ({ finished: true, exitCode: 0 }),
        backendAlive: async () => false,
      }
    );
    assert.equal(footer.exitCode, 0);
  } finally {
    __setIsolationRunnerForTests(null);
  }
});

test('watcher counters reach diagnostics even without a final solve resource snapshot', async () => {
  const { diagnosis } = await buildKillDiagnosticsSection(null, {
    exitCode: 137,
    reportedCgroupMemory: counters,
    collectSystem: async () => null,
  });
  assert.equal(diagnosis.cause, 'out-of-memory');
  assert.match(diagnosis.evidence.join('\n'), /start-command.*container cgroup.*5 process/);
  assert.match(diagnosis.evidence.join('\n'), /2\.9 GB limit/);
  assert.doesNotMatch(diagnosis.evidence.join('\n'), /across 2 OOM event/);
});

test('a watcher sample missing the final increment does not erase a solve OOM observation', () => {
  const diagnosis = describeKillCause({
    exitCode: 137,
    reportedCgroupMemory: { ...counters, oomKills: 0 },
    resourceMarkers: { markers: [{ phase: 'after-agent', cgroupMemory: counters }] },
  });
  assert.equal(diagnosis.cause, 'out-of-memory');
});

test('a prior container OOM does not explain SIGTERM or a runtime self-abort', () => {
  const term = describeKillCause({ exitCode: 143, oomKilled: true, reportedCgroupMemory: counters });
  assert.equal(term.cause, 'forced-kill');
  assert.match(term.evidence.join('\n'), /OOMKilled/);
  const v8 = describeKillCause({ exitCode: 134, oomKilled: true, reportedCgroupMemory: counters, logText: 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n' });
  assert.equal(v8.cause, 'out-of-memory');
  assert.match(v8.summary, /runtime hit its own heap limit/);
});

test('the monitor cgroup and unrelated kernel victims cannot attribute a task kill', async () => {
  const { diagnosis } = await buildKillDiagnosticsSection(null, {
    exitCode: 143,
    collectSystem: async () => ({ cgroup: { oomKill: 12 }, victims: [{ comm: 'unrelated-task', pid: 42 }], memory: {} }),
  });
  assert.equal(diagnosis.cause, 'forced-kill');
  assert.doesNotMatch(diagnosis.summary, /unrelated-task/);
  assert.match(diagnosis.evidence.join('\n'), /monitor.*12 OOM kill/);
});
