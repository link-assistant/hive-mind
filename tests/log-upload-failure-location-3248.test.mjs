#!/usr/bin/env node
/**
 * Issue #3248 item 3: the failure comment must point to a log that exists.
 *
 * On PR #3225 the Formal AI draft posted "Log Upload Failed … not attached here"
 * (the workflow `GITHUB_TOKEN` cannot create gists) and named
 * `/home/box/logs/solve-….log` inside a `docker run --rm` container that no
 * longer existed. Two seconds later `--development-log` committed the complete
 * log to the pull request branch, and the workflow had uploaded it as an
 * artifact too. The comment pointed at the one place the log was not.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveCiRunUrl, isEphemeralContainer } from '../src/ci-run-url.lib.mjs';
import { buildLogUploadFailureComment, describeLogFileLocation, formatLogLocationConsoleLines } from '../src/log-upload-failure.lib.mjs';
import { createDevelopmentLogFinalizer, getActiveDevelopmentLogRepositoryPath, setActiveDevelopmentLogFinalizer } from '../src/development-log.finalize.lib.mjs';

const LOG_FILE = '/home/box/logs/solve-2026-10-14T05-22-42-000Z.log';
const ACTIONS_ENV = { GITHUB_ACTIONS: 'true', GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'link-assistant/hive-mind', GITHUB_RUN_ID: '38515996193' };
const RUN_URL = 'https://github.com/link-assistant/hive-mind/actions/runs/38515996193';
const inContainer = () => ({ inContainer: true, runtime: 'docker' });

test('the run URL is derived from the GitHub Actions environment, or passed in explicitly', () => {
  assert.equal(resolveCiRunUrl(ACTIONS_ENV), RUN_URL);
  assert.equal(resolveCiRunUrl({ ...ACTIONS_ENV, GITHUB_SERVER_URL: 'https://ghe.example.com/' }), 'https://ghe.example.com/link-assistant/hive-mind/actions/runs/38515996193');
  assert.equal(resolveCiRunUrl({ HIVE_MIND_CI_RUN_URL: RUN_URL }), RUN_URL, 'a container started by the workflow has no GITHUB_* variables, so the workflow passes the URL in');
  assert.equal(resolveCiRunUrl({}), null);
  assert.equal(resolveCiRunUrl({ ...ACTIONS_ENV, GITHUB_ACTIONS: undefined }), null, 'outside Actions there is no run to link');
  assert.equal(resolveCiRunUrl({ ...ACTIONS_ENV, GITHUB_RUN_ID: '1; rm -rf /' }), null);
  assert.equal(resolveCiRunUrl({ HIVE_MIND_CI_RUN_URL: 'javascript:alert(1)' }), null, 'only an http(s) URL is ever linked');
  assert.equal(isEphemeralContainer({ HIVE_MIND_EPHEMERAL_CONTAINER: '1' }), true);
  assert.equal(isEphemeralContainer({}), false);
});

test('a --rm container gets no path and no gh-upload-log command, and links the workflow run instead', () => {
  const location = describeLogFileLocation({ env: { HIVE_MIND_EPHEMERAL_CONTAINER: '1', HIVE_MIND_CI_RUN_URL: RUN_URL }, detectContext: inContainer });
  assert.deepStrictEqual(location, { kind: 'ephemeral-container', runUrl: RUN_URL });

  const body = buildLogUploadFailureComment({ errorMessage: 'Agent reported error', failureReason: 'HTTP 403', logSizeBytes: 1_095_066, logFile: LOG_FILE, location });
  assert.ok(!body.includes(LOG_FILE), `the container path must not be printed:\n${body}`);
  assert.ok(!body.includes('gh-upload-log "'), 'there is no file left to run gh-upload-log on');
  assert.ok(body.includes(`[workflow run](${RUN_URL})`), body);
  assert.match(body, /artifact/i, 'the reader is told the log is a run artifact');
  assert.match(body, /removed when the session ended/);

  const console = formatLogLocationConsoleLines(LOG_FILE, location);
  assert.ok(
    console.some(line => line.includes(RUN_URL)),
    console.join('\n')
  );
});

test('a --rm container outside Actions says the log is gone rather than naming a dead path', () => {
  const location = describeLogFileLocation({ env: { HIVE_MIND_EPHEMERAL_CONTAINER: '1' }, detectContext: inContainer });
  assert.deepStrictEqual(location, { kind: 'ephemeral-container' });
  const body = buildLogUploadFailureComment({ logSizeBytes: 1024, logFile: LOG_FILE, location });
  assert.ok(!body.includes(LOG_FILE), body);
  assert.ok(!body.includes('gh-upload-log "'), body);
});

test('every other location also links the run when there is one', () => {
  const host = describeLogFileLocation({ env: ACTIONS_ENV, detectContext: () => ({ inContainer: false }) });
  assert.deepStrictEqual(host, { kind: 'host', runUrl: RUN_URL });
  const body = buildLogUploadFailureComment({ logSizeBytes: 1024, logFile: LOG_FILE, location: host });
  assert.ok(body.includes(LOG_FILE), 'on the runner itself the path is real');
  assert.ok(body.includes(`[workflow run](${RUN_URL})`), body);

  assert.deepStrictEqual(describeLogFileLocation({ env: {}, detectContext: () => ({ inContainer: false }) }), { kind: 'host' }, 'no run, no key');
});

test('a failure path without a repository path still publishes to the branch the development log is committed to', async () => {
  setActiveDevelopmentLogFinalizer(null);
  assert.equal(getActiveDevelopmentLogRepositoryPath(), null);
  createDevelopmentLogFinalizer({ collect: async () => ({}), getParams: () => ({ repositoryPath: '/tmp/gh-issue-solver-1' }) });
  assert.equal(getActiveDevelopmentLogRepositoryPath(), '/tmp/gh-issue-solver-1');
  setActiveDevelopmentLogFinalizer(null);
});
