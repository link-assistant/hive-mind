/**
 * @hive-mind-test-suite default
 * Regression coverage for issue #2625 (Formal AI Draft run 37606848542, step
 * "Open the Formal AI draft").
 *
 * The draft job runs with the workflow's GITHUB_TOKEN, an integration token
 * that cannot create gists. gh-upload-log answered every attempt with
 *
 *   X Failed to create gist: HTTP 403: Resource not accessible by integration
 *
 * and the upload was retried after 30 s and 2 min anyway, then re-sent as
 * parts that failed the same way. A permission refusal is a decision, not a
 * transient error, so it now ends the upload on the first attempt. Secondary
 * rate limits are also HTTP 403 and keep their retries.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2625
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { isPermanentUploadFailure, uploadLogWithGhUploadLog } from '../src/log-upload.lib.mjs';

// The failing run's gh-upload-log output, trimmed.
const INTEGRATION_403_OUTPUT = `Strategy: File fits in a Gist
X Failed to create gist: HTTP 403: Resource not accessible by integration (https://api.github.com/gists)
❌ Error: Failed to fetch authenticated GitHub username: gh: Resource not accessible by integration (HTTP 403)`;

const SECONDARY_RATE_LIMIT_OUTPUT = 'X Failed to create gist: HTTP 403: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (https://api.github.com/gists)';

const withTempLog = async (content, fn) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2625-upload-'));
  try {
    const logFile = path.join(dir, 'session.log');
    await fs.writeFile(logFile, content);
    return await fn(logFile);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
};

test('a token that may not create gists is recognised as a permanent failure', () => {
  assert.equal(isPermanentUploadFailure(INTEGRATION_403_OUTPUT), true);
  assert.equal(isPermanentUploadFailure('gh: Resource not accessible by personal access token (HTTP 403)'), true);
});

test('transient failures, including secondary rate limits, are not permanent', () => {
  assert.equal(isPermanentUploadFailure(SECONDARY_RATE_LIMIT_OUTPUT), false);
  assert.equal(isPermanentUploadFailure('error: RPC failed; HTTP 408 curl 22 The requested URL returned error: 408'), false);
  assert.equal(isPermanentUploadFailure(''), false);
});

test('the upload stops after one attempt and does not retry as parts', async () => {
  await withTempLog('x\n'.repeat(4096), async logFile => {
    const sleeps = [];
    const calls = [];
    const result = await uploadLogWithGhUploadLog({
      logFile,
      isPublic: true,
      description: 'log',
      partSizeBytes: 1024,
      sleep: async ms => sleeps.push(ms),
      runUpload: async args => {
        calls.push(args[0]);
        return { code: 1, stdout: '', stderr: INTEGRATION_403_OUTPUT };
      },
    });
    assert.equal(result.success, false);
    assert.equal(result.attempts, 1);
    assert.deepEqual(sleeps, []);
    assert.equal(calls.length, 1, 'no part uploads either');
    assert.match(result.failureReason, /Resource not accessible by integration/);
  });
});

test('a secondary rate limit is still retried', async () => {
  await withTempLog('x\n', async logFile => {
    const sleeps = [];
    const result = await uploadLogWithGhUploadLog({ logFile, isPublic: true, description: 'log', sleep: async ms => sleeps.push(ms), runUpload: async () => ({ code: 1, stdout: '', stderr: SECONDARY_RATE_LIMIT_OUTPUT }) });
    assert.equal(result.success, false);
    assert.equal(result.attempts, 3);
    assert.deepEqual(sleeps, [30_000, 120_000]);
  });
});
