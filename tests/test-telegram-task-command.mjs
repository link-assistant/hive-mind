#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 */

import assert from 'assert/strict';
import { applyTaskCommandDefaults, buildTaskCommandArgs, findTaskIssueUrl, getTaskCommandNameFromText, getTaskToolFromArgs } from '../src/telegram-task-command.lib.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.message}`);
    failed++;
  }
}

const issueUrl = 'https://github.com/link-assistant/hive-mind/issues/501';

test('/task command is recognized', () => {
  assert.equal(getTaskCommandNameFromText(`/task ${issueUrl}`), 'task');
  assert.equal(getTaskCommandNameFromText(`/split@SwarmMindBot ${issueUrl}`), 'split');
  assert.equal(getTaskCommandNameFromText(`/solve ${issueUrl}`), null);
});

test('/split adds --split by default and keeps user options', () => {
  const built = buildTaskCommandArgs(`/split --model opus ${issueUrl}`);
  assert.deepEqual(built.args, [issueUrl, '--model', 'opus', '--split']);
  assert.equal(built.issueUrl, issueUrl);
});

test('explicit --split is not duplicated', () => {
  const args = applyTaskCommandDefaults([issueUrl, '--split', '--split-count', '3']);
  assert.equal(args.filter(arg => arg === '--split').length, 1);
});

test('pull request URLs are not accepted as task issue URL', () => {
  assert.equal(findTaskIssueUrl(['https://github.com/link-assistant/hive-mind/pull/553']), null);
});

test('tool can be parsed from task command arguments', () => {
  assert.equal(getTaskToolFromArgs([issueUrl, '--tool', 'codex']), 'codex');
  assert.equal(getTaskToolFromArgs([issueUrl, '--tool=agent']), 'agent');
  assert.equal(getTaskToolFromArgs([issueUrl]), 'claude');
});

console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
