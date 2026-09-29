/**
 * @hive-mind-test-suite default
 * Issue #2301 (link-foundation/meta-language#196): the AI session failed, its log upload died with
 * HTTP 408, and the automation-stop comment still said "Review the attached working session log".
 * The stop comment now says whether the log was attached, and every caller that attaches a failure
 * log passes that result on. The watch loop attaches the failure log before its own stop comment.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { buildAutomationStopComment, STOP_REASONS } from '../src/automation-stop-reporting.lib.mjs';

const ATTACHED = /Review the attached working session log/;

test('a stop comment only mentions an attached log when one was attached', () => {
  for (const reason of ['tool_failure', 'tool_failure_after_resume']) {
    assert.match(buildAutomationStopComment({ reason, logAttached: true }), ATTACHED);

    const notUploaded = buildAutomationStopComment({ reason, logAttached: false });
    assert.doesNotMatch(notUploaded, ATTACHED);
    assert.match(notUploaded, /could not be attached/);
    assert.match(notUploaded, /Log Upload Failed/);

    const notAttempted = buildAutomationStopComment({ reason });
    assert.doesNotMatch(notAttempted, /attached/);
    assert.match(notAttempted, /Review the working session log for the failure/);
  }
});

test('reasons without a log step are unchanged by logAttached', () => {
  for (const reason of Object.keys(STOP_REASONS)) {
    if (reason.startsWith('tool_failure')) continue;
    assert.equal(buildAutomationStopComment({ reason, logAttached: false }), buildAutomationStopComment({ reason, logAttached: true }), reason);
  }
});

test('every tool_failure stop passes the result of its log upload', async () => {
  for (const file of ['src/solve.auto-merge.lib.mjs', 'src/solve.watch.lib.mjs']) {
    const source = await fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    const calls = [...source.matchAll(/reportAutomationStop\(\{[\s\S]*?\}\);/g)].map(match => match[0]).filter(call => /reason: 'tool_failure/.test(call));
    assert.ok(calls.length > 0, file);
    for (const call of calls) assert.match(call, /logAttached/, `${file}: ${call.slice(0, 120)}`);
  }
});

test('the watch loop attaches the failure log before its API-error stop comment', async () => {
  const source = await fs.readFile(new URL('../src/solve.watch.lib.mjs', import.meta.url), 'utf8');
  const attach = source.indexOf('const logAttached = await attachFailureLog();');
  const stop = source.indexOf("reason: 'tool_failure'");
  assert.ok(attach > 0 && attach < stop);
});
