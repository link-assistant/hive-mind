#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Issue #3614: the images pin start-command 0.39.2, which fixes the
 * detached monitor's 1 s docker loop this issue reported upstream
 * (link-foundation/start#238, #242) and makes `$ --status` cheaper (#243).
 * 0.39.0 also adds fields to the status record. This test feeds a 0.39.0
 * record to the bot's parser and kill diagnostics:
 * - the new `killed (docker daemon restart)` exit reason (start#241) and the
 *   `exitEvidence.daemonRestartSource` / `options.init` fields parse;
 * - a daemon-restart exit 137 is reported as that reason, not as memory
 *   exhaustion.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3614
 * @see https://github.com/link-foundation/start/issues/238
 */

import assert from 'assert/strict';
import { parseSessionStatusOutput } from '../src/isolation-runner.parsers.lib.mjs';
import { describeKillCause } from '../src/session-kill-diagnostics.lib.mjs';

// Shape of `$ --status <uuid> --output-format json` from start-command 0.39.0
// (captured from a real detached docker run, exit fields set to a daemon restart).
const record = {
  uuid: '2f120e8f-89a2-4df4-af42-ddb6161bc677',
  pid: 13072,
  processIds: { wrapperPid: 13072, containerId: '2d22c9d6a94ef680a57446ffacd9392f08950ff9977dc183f7da44f64b6afecc' },
  status: 'executed',
  exitCode: 137,
  command: 'sleep 140',
  logPath: '/tmp/start-command/logs/isolation/docker/2f120e8f-89a2-4df4-af42-ddb6161bc677.log',
  startTime: '2026-10-22T21:34:28.571Z',
  endTime: '2026-10-22T21:34:38.767Z',
  oomKilled: false,
  exitReason: 'killed (docker daemon restart)',
  workingDirectory: '/tmp/work',
  options: {
    isolated: 'docker',
    isolationMode: 'detached',
    sessionName: 'solve-task-1',
    image: 'alpine:3.20',
    init: null,
    exitEvidence: { daemonRestart: true, daemonRestartSource: 'api', mainOom: false },
  },
};

let failures = 0;
const test = (name, fn) => {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures++;
    console.error(`✗ ${name}\n  ${error.stack}`);
  }
};

test('a start-command 0.39.0 status record parses, including the daemon-restart exit reason', () => {
  const status = parseSessionStatusOutput(JSON.stringify(record));
  assert.equal(status.exists, true);
  assert.equal(status.uuid, record.uuid);
  assert.equal(status.status, 'executed');
  assert.equal(status.exitCode, 137);
  assert.equal(status.oomKilled, false);
  assert.equal(status.exitReason, 'killed (docker daemon restart)');
  assert.equal(status.sessionName, 'solve-task-1');
});

test('a daemon-restart exit 137 is shown as the reported reason, not as memory exhaustion', () => {
  const status = parseSessionStatusOutput(JSON.stringify(record));
  const diagnosis = describeKillCause({ exitCode: status.exitCode, oomKilled: status.oomKilled, reportedExitReason: status.exitReason });
  assert.equal(diagnosis.reportedMemoryExhaustion, false);
  assert.equal(diagnosis.reportedExitReason, 'killed (docker daemon restart)');
  assert.match(diagnosis.evidence.join('\n'), /exitReason = killed \(docker daemon restart\)/);
});

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nAll start-command 0.39.0 compatibility tests passed');
