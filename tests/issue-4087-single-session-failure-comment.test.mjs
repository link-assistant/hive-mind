/**
 * @hive-mind-test-suite default
 * Issue #4087 (konard/voice-simulator#146): an AI session failed with a non-usage-limit error and
 * `--auto-restart-until-mergeable --attach-logs` posted two comments for that one failure:
 *   1. "🚨 Solution Draft Failed" with the error, the models and the failure log (18:26:04Z);
 *   2. "🛑 Automation stopped: the AI session failed" (`tool_failure`), repeating the error (18:26:06Z).
 * The repository owner: "if something failed `Solution Draft Failed` comment must be enough".
 *
 * Now the stop comment is skipped for `tool_failure` / `tool_failure_after_resume` whenever the
 * failure comment for the same session reached the pull request, and still posted when it did not
 * (log upload disabled, or nothing could be posted), so every failure is reported exactly once.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { attachLogToGitHub, getLastLogAttachOutcome } from '../src/github.lib.mjs';
import { buildAutomationStopComment, isStopAlreadyReportedByFailureComment, reportAutomationStop, SESSION_FAILURE_STOP_REASONS, STOP_REASONS } from '../src/automation-stop-reporting.lib.mjs';
import { AUTOMATION_STOPPED_MARKER, LOG_UPLOAD_FAILED_MARKER, SOLUTION_DRAFT_FAILED_MARKER } from '../src/tool-comments.lib.mjs';
import { forgetLogUploadFailureReports } from '../src/log-upload-failure.lib.mjs';

const CODEX_ERROR = 'CODEX execution failed: Codex emitted error event: Incomplete response returned, reason: max_output_tokens';
const TARGET = { owner: 'konard', repo: 'voice-simulator', targetNumber: 146 };

/** A command-stream `$` stand-in that records every comment POST (the only calls with stdin). */
const createFakeGh = () => {
  const posts = [];
  let nextId = 6957087059;
  const $ = first => {
    if (Array.isArray(first)) return Promise.resolve({ code: 0, stdout: 'public', stderr: '' });
    return async (strings, ...rest) => {
      const command = strings.reduce((text, part, index) => text + part + (index < rest.length ? rest[index] : ''), '');
      if (first?.stdin) {
        posts.push({ command, body: JSON.parse(first.stdin).body });
        return { code: 0, stdout: JSON.stringify({ id: nextId++ }), stderr: '' };
      }
      return { code: 0, stdout: 'public', stderr: '' };
    };
  };
  return { $, posts };
};

/** What the auto-restart loop does after a failed session (src/solve.auto-merge.lib.mjs). */
const failSession = async ({ $, logFile, attachLogs = true, reason = 'tool_failure', logs = [] }) => {
  const log = async message => logs.push(String(message));
  let logAttached = null;
  let failureReported = false;
  if (attachLogs) {
    logAttached = await attachLogToGitHub({ logFile, targetType: 'pr', ...TARGET, $, log, sanitizeLogContent: async text => text, errorMessage: CODEX_ERROR, uploadRetryDelaysMs: [], recordResources: async () => {} });
    failureReported = getLastLogAttachOutcome().failureCommentPosted;
  }
  const stop = await reportAutomationStop({ $, ...TARGET, reason, mode: 'auto-restart-until-mergeable', message: CODEX_ERROR, log, logAttached, failureReported });
  return { logAttached, failureReported, stop };
};

const withTempDir = async fn => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-4087-'));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
};

test('a failed session with --attach-logs gives exactly one pull request comment', async () => {
  await withTempDir(async dir => {
    const logFile = path.join(dir, 'solve.log');
    await fs.writeFile(logFile, '[2026-11-17T18:18:53Z] turn.failed: Incomplete response returned, reason: max_output_tokens\n');
    for (const reason of SESSION_FAILURE_STOP_REASONS) {
      const { $, posts } = createFakeGh();
      const logs = [];
      const { logAttached, failureReported, stop } = await failSession({ $, logFile, reason, logs });
      assert.equal(logAttached, true, logs.join('\n'));
      assert.equal(failureReported, true);
      assert.equal(posts.length, 1, `${reason}: expected one comment, got ${posts.length}`);
      assert.ok(posts[0].body.includes(`🚨 ${SOLUTION_DRAFT_FAILED_MARKER}`));
      assert.ok(posts[0].body.includes(CODEX_ERROR));
      assert.ok(!posts.some(post => post.body.includes(AUTOMATION_STOPPED_MARKER)), 'no "Automation stopped" comment');
      assert.deepEqual(stop, { posted: false, reason, skipped: 'failure_already_reported' });
      assert.match(logs.join('\n'), /already reports this failure/);
    }
  });
});

test('a failed upload still leaves a single comment: its "Solution Draft Failed" heading carries the error', async () => {
  await withTempDir(async dir => {
    const originalPath = process.env.PATH;
    try {
      await fs.writeFile(path.join(dir, 'gh-upload-log'), `#!/bin/sh\necho "error: RPC failed; HTTP 408 curl 22 The requested URL returned error: 408" >&2\nexit 1\n`, { mode: 0o755 });
      process.env.PATH = `${dir}${path.delimiter}${originalPath}`;
      const logFile = path.join(dir, 'big.log');
      await fs.writeFile(logFile, 'a transcript line\n'.repeat(8000));
      forgetLogUploadFailureReports();
      const { $, posts } = createFakeGh();
      const logs = [];
      const { logAttached, failureReported, stop } = await failSession({ $, logFile, logs });
      assert.equal(logAttached, false, 'the log was not attached');
      assert.equal(failureReported, true);
      assert.equal(posts.length, 1, logs.join('\n'));
      assert.ok(posts[0].body.includes(`🚨 ${SOLUTION_DRAFT_FAILED_MARKER}`));
      assert.ok(posts[0].body.includes(LOG_UPLOAD_FAILED_MARKER));
      assert.ok(posts[0].body.includes(CODEX_ERROR));
      assert.equal(stop.skipped, 'failure_already_reported');
    } finally {
      process.env.PATH = originalPath;
      forgetLogUploadFailureReports();
    }
  });
});

test('nothing reached the pull request: the outcome says so, so the stop comment is still posted', async () => {
  await withTempDir(async dir => {
    const logFile = path.join(dir, 'empty.log');
    await fs.writeFile(logFile, '');
    const { $, posts } = createFakeGh();
    const attached = await attachLogToGitHub({ logFile, targetType: 'pr', ...TARGET, $, log: async () => {}, errorMessage: CODEX_ERROR, recordResources: async () => {} });
    assert.equal(attached, false);
    assert.equal(posts.length, 0);
    assert.deepEqual(getLastLogAttachOutcome(), { attached: false, failureCommentPosted: false });
  });
  // Log upload disabled (no --attach-logs) or nothing posted: the stop comment is the only report.
  for (const failureReported of [false, null, undefined]) {
    assert.equal(isStopAlreadyReportedByFailureComment('tool_failure', failureReported), false);
  }
});

test('a log without a session error, or a usage-limit log, is not a failure comment', async () => {
  await withTempDir(async dir => {
    const logFile = path.join(dir, 'solve.log');
    await fs.writeFile(logFile, 'a working session line\n');
    const { $ } = createFakeGh();
    assert.equal(await attachLogToGitHub({ logFile, targetType: 'pr', ...TARGET, $, log: async () => {}, sanitizeLogContent: async text => text, recordResources: async () => {} }), true);
    assert.deepEqual(getLastLogAttachOutcome(), { attached: true, failureCommentPosted: false });
    assert.equal(await attachLogToGitHub({ logFile, targetType: 'pr', ...TARGET, $, log: async () => {}, sanitizeLogContent: async text => text, recordResources: async () => {}, errorMessage: 'usage limit', isUsageLimit: true }), true);
    assert.equal(getLastLogAttachOutcome().failureCommentPosted, false);
  });
});

test('only session-failure stops are suppressed by a failure comment', () => {
  assert.deepEqual([...SESSION_FAILURE_STOP_REASONS].sort(), ['tool_failure', 'tool_failure_after_resume']);
  for (const reason of Object.keys(STOP_REASONS)) {
    assert.equal(isStopAlreadyReportedByFailureComment(reason, true), SESSION_FAILURE_STOP_REASONS.includes(reason), reason);
  }
  // The stop comment itself is unchanged for the cases where it is still posted.
  assert.match(buildAutomationStopComment({ reason: 'tool_failure', mode: 'auto-restart-until-mergeable', message: CODEX_ERROR }), /the AI session failed/);
});

test('both auto-restart session-failure stops pass whether the failure comment reached the pull request', async () => {
  const source = await fs.readFile(new URL('../src/solve.auto-merge.lib.mjs', import.meta.url), 'utf8');
  const calls = [...source.matchAll(/reportAutomationStop\(\{[\s\S]*?\}\);/g)].map(match => match[0]).filter(call => /reason: 'tool_failure/.test(call));
  assert.equal(calls.length, 2);
  for (const call of calls) assert.match(call, /failureReported/, call.slice(0, 160));
  assert.equal((source.match(/= getLastLogAttachOutcome\(\)\.failureCommentPosted;/g) || []).length, 2);
});
