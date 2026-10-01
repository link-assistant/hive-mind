#!/usr/bin/env node
/**
 * Issue #2400: one failed log upload must produce one "Log Upload Failed" comment,
 * and that comment must say where the log really is.
 *
 * On link-assistant/hive-mind#2398 the session (Docker isolation, image 2.33.2):
 *
 *   15:03:57  verifyResults → attachLogToGitHub → sanitization blocked → "Log Upload Failed"
 *   15:06:38  "✅ Ready to merge"
 *   15:06:44  --attach-logs safety net → attachLogToGitHub again → same failure →
 *             a second, byte-identical "Log Upload Failed" comment
 *   15:06:50  start-command removed the container (exit 0), and with it the
 *             `/home/box/<uuid>.log` path that both comments told the reader to use.
 *
 * The fakes below replay that sequence with the real postTrackedComment.
 */

import assert from 'assert';
import { attachFinalLogIfMissing } from '../src/attach-logs-guarantee.lib.mjs';
import { buildLogUploadFailureComment, describeLogFileLocation, forgetLogUploadFailureReports, formatLogLocationConsoleLines, postLogUploadFailureComment } from '../src/log-upload-failure.lib.mjs';
import { postTrackedComment, resetTrackedToolCommentIds } from '../src/tool-comments.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    resetTrackedToolCommentIds();
    forgetLogUploadFailureReports();
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}`);
    failed++;
  }
}

const LOG_FILE = '/home/box/12973819-edf2-46a1-9507-73725ece23dd.log';
const SANITIZATION_FAILURE = 'Credential sanitization failed; publication was blocked.';
const HOST = { kind: 'host' };

/** A GitHub stand-in that records every posted comment body. */
/** command-stream `$` stand-in: `$({stdin})\`gh api …\`` answers like the API. */
const fakeGhApi = id => () => async () => ({ code: 0, stdout: JSON.stringify({ id }) });

const createFakeGitHub = () => {
  const posted = [];
  let nextId = 5934184600;
  const postComment = async ({ owner, repo, targetNumber, bodyFile }) => {
    const fs = await import('node:fs/promises');
    const body = await fs.readFile(bodyFile, 'utf8');
    const result = await postTrackedComment({ $: fakeGhApi(nextId++), owner, repo, targetNumber, body });
    posted.push(body);
    return result;
  };
  return { posted, postComment };
};

const quietLog = async () => {};

/** attachLogToGitHub stand-in whose upload always fails and reports through the real poster. */
const createFailingAttach = ({ postComment, logLines, globalState }) => {
  return async ({ owner, repo, targetNumber, targetType = 'pr', logFile }) => {
    await postLogUploadFailureComment({ $: null, owner, repo, targetNumber, targetType, log: async line => logLines.push(line), postComment, failureReason: SANITIZATION_FAILURE, logFile, logSizeBytes: 8 * 1024 * 1024, isPublic: true, location: HOST });
    globalState.latestLogAttachFailed = true;
    return false;
  };
};

await test('replay of #2398: the safety-net retry does not post a second "Log Upload Failed" comment', async () => {
  const github = createFakeGitHub();
  const logLines = [];
  const globalState = {};
  const attachLogToGitHub = createFailingAttach({ postComment: github.postComment, logLines, globalState });
  const target = { owner: 'link-assistant', repo: 'hive-mind', targetNumber: 2398 };

  // 15:03:57: verifyResults uploads the log, which fails and is reported.
  await attachLogToGitHub({ ...target, logFile: LOG_FILE });
  // 15:06:38: a status comment lands in between.
  await postTrackedComment({ $: fakeGhApi(1), ...target, body: '## ✅ Ready to merge' });
  // 15:06:44: the --attach-logs safety net sees no attached log and retries.
  const result = await attachFinalLogIfMissing({ shouldAttachLogs: true, prNumber: 2398, owner: target.owner, repo: target.repo, $: null, log: quietLog, sanitizeLogContent: x => x, getLogFile: () => LOG_FILE, attachLogToGitHub, argv: {}, globalState });

  assert.strictEqual(result, false, 'the log is still not attached');
  assert.strictEqual(github.posted.length, 1, `expected one "Log Upload Failed" comment, got ${github.posted.length}`);
  assert.ok(
    logLines.some(line => line.includes('already on the pull request') && line.includes('5934184600')),
    `the skipped repeat is logged with the earlier comment id: ${JSON.stringify(logLines)}`
  );
});

await test('a different session error on the same target is still reported', async () => {
  const github = createFakeGitHub();
  const params = { $: null, owner: 'o', repo: 'r', targetNumber: 1, log: quietLog, postComment: github.postComment, logFile: LOG_FILE, logSizeBytes: 1024, location: HOST };
  assert.strictEqual(await postLogUploadFailureComment({ ...params, failureReason: SANITIZATION_FAILURE }), true);
  assert.strictEqual(await postLogUploadFailureComment({ ...params, failureReason: 'HTTP 408' }), true);
  assert.strictEqual(github.posted.length, 1, 'same log, same session outcome: one comment');
  assert.strictEqual(await postLogUploadFailureComment({ ...params, errorMessage: 'Claude exited with code 1', failureReason: SANITIZATION_FAILURE }), true);
  assert.strictEqual(github.posted.length, 2, 'a new session failure is a new report');
});

await test('other targets and other log files get their own report', async () => {
  const github = createFakeGitHub();
  const params = { $: null, owner: 'o', repo: 'r', log: quietLog, postComment: github.postComment, failureReason: SANITIZATION_FAILURE, logSizeBytes: 1024, location: HOST };
  await postLogUploadFailureComment({ ...params, targetNumber: 1, logFile: LOG_FILE });
  await postLogUploadFailureComment({ ...params, targetNumber: 2, logFile: LOG_FILE });
  await postLogUploadFailureComment({ ...params, targetNumber: 2, targetType: 'issue', logFile: LOG_FILE });
  await postLogUploadFailureComment({ ...params, targetNumber: 1, logFile: '/tmp/other.log' });
  assert.strictEqual(github.posted.length, 4);
});

await test('after a successful attach, a later failure is reported again', async () => {
  const github = createFakeGitHub();
  const params = { $: null, owner: 'o', repo: 'r', targetNumber: 7, log: quietLog, postComment: github.postComment, failureReason: SANITIZATION_FAILURE, logFile: LOG_FILE, logSizeBytes: 1024, location: HOST };
  await postLogUploadFailureComment(params);
  forgetLogUploadFailureReports({ owner: 'o', repo: 'r', targetType: 'pr', targetNumber: 7 });
  await postLogUploadFailureComment(params);
  assert.strictEqual(github.posted.length, 2);
});

await test('a comment that could not be posted is not remembered', async () => {
  let calls = 0;
  const postComment = async () => {
    calls++;
    return calls === 1 ? { ok: false, stderr: 'HTTP 502' } : { ok: true, commentId: 9 };
  };
  const params = { $: null, owner: 'o', repo: 'r', targetNumber: 3, log: quietLog, postComment, failureReason: SANITIZATION_FAILURE, logFile: LOG_FILE, logSizeBytes: 1024, location: HOST };
  assert.strictEqual(await postLogUploadFailureComment(params), false);
  assert.strictEqual(await postLogUploadFailureComment(params), true);
  assert.strictEqual(calls, 2, 'the retry posts, because nothing is on the target yet');
});

await test('Docker isolation: the comment says the path is inside the container and how to reach the log', async () => {
  const sessionId = 'eebf035f-bdd1-450e-958c-2f6bce262b9e';
  const location = describeLogFileLocation({ env: { HIVE_MIND_PARENT_SESSION_ID: sessionId }, detectContext: () => ({ inContainer: true, runtime: 'docker' }) });
  assert.deepStrictEqual(location, { kind: 'isolated-container', sessionId });
  const body = buildLogUploadFailureComment({ failureReason: SANITIZATION_FAILURE, logSizeBytes: 8 * 1024 * 1024, logFile: LOG_FILE, location });
  assert.ok(!body.includes('kept on the machine that ran this session'), 'must not claim the file is on the host');
  assert.ok(body.includes(`isolated Docker container of session \`${sessionId}\``), body);
  assert.ok(body.includes('exists only inside the container'), body);
  assert.ok(body.includes(`docker cp "${sessionId}:${LOG_FILE}" .`), body);
  assert.ok(body.includes(`/log ${sessionId}`) && body.includes(`$ --status ${sessionId}`), body);
  const lines = formatLogLocationConsoleLines(LOG_FILE, location);
  assert.ok(lines[0].includes(`inside isolated container ${sessionId}`), lines[0]);
  assert.ok(!lines.join('\n').includes('available locally'), lines.join('\n'));
});

await test('a plain container (no isolation runner) is named as such', async () => {
  const location = describeLogFileLocation({ env: {}, detectContext: () => ({ inContainer: true, runtime: 'docker' }) });
  assert.deepStrictEqual(location, { kind: 'container', runtime: 'docker' });
  const body = buildLogUploadFailureComment({ logSizeBytes: 1024, logFile: LOG_FILE, location });
  assert.ok(body.includes('inside the docker container that ran this session'), body);
  assert.deepStrictEqual(formatLogLocationConsoleLines(LOG_FILE, location), [`  📁 Full log remains available inside this docker container at: ${LOG_FILE}`]);
});

await test('on a host the wording is unchanged', async () => {
  const location = describeLogFileLocation({ env: {}, detectContext: () => ({ inContainer: false, runtime: null }) });
  assert.deepStrictEqual(location, HOST);
  const body = buildLogUploadFailureComment({ logSizeBytes: 1024, logFile: LOG_FILE, location });
  assert.ok(body.includes(`The complete log is kept on the machine that ran this session:\n\`\`\`\n${LOG_FILE}\n\`\`\``), body);
  assert.deepStrictEqual(formatLogLocationConsoleLines(LOG_FILE, location), [`  📁 Full log remains available locally at: ${LOG_FILE}`]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
