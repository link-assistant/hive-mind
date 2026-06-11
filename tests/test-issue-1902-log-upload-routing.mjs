/**
 * @hive-mind-test-suite default
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGhUploadLogArgs, selectGhUploadLogMode } from '../src/log-upload.lib.mjs';

const FILE_MAX_SIZE = 25 * 1024 * 1024;

test('issue #1902: logs that fit GitHub file limits use gist-only mode', () => {
  const issueLogSize = 20_632_466;
  const mode = selectGhUploadLogMode({
    logSize: issueLogSize,
    fileMaxSize: FILE_MAX_SIZE,
  });

  assert.equal(mode, 'gist');

  const args = buildGhUploadLogArgs({
    logFile: '/tmp/solution-draft-log-pr-1781180521736.txt',
    isPublic: true,
    description: 'Solution draft log for https://github.com/lefinepro/kefine/pull/173',
    mode,
    verbose: true,
  });

  assert.deepEqual(args, ['/tmp/solution-draft-log-pr-1781180521736.txt', '--public', '--only-gist', '--description', 'Solution draft log for https://github.com/lefinepro/kefine/pull/173', '--verbose']);
  assert.equal(args.includes('--only-repository'), false);
  assert.equal(args.includes('--shared-repository'), false);
});

test('issue #1902: oversized logs use repository-only shared mode', () => {
  const mode = selectGhUploadLogMode({
    logSize: FILE_MAX_SIZE + 1,
    fileMaxSize: FILE_MAX_SIZE,
  });

  assert.equal(mode, 'repository');

  const args = buildGhUploadLogArgs({
    logFile: '/tmp/solution-draft-log-pr-large.txt',
    isPublic: false,
    description: 'Solution draft log for https://github.com/link-assistant/hive-mind/pull/1909',
    mode,
    verbose: false,
  });

  assert.deepEqual(args, ['/tmp/solution-draft-log-pr-large.txt', '--private', '--only-repository', '--shared-repository', '--description', 'Solution draft log for https://github.com/link-assistant/hive-mind/pull/1909']);
  assert.equal(args.includes('--only-gist'), false);
  assert.equal(args.includes('--no-shared-repository'), false);
});
