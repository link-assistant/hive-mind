/**
 * @hive-mind-test-suite default
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGhUploadLogArgs } from '../src/log-upload.lib.mjs';

test('issue #1902: default log uploads keep gh-upload-log auto mode with shared repository fallback', () => {
  const args = buildGhUploadLogArgs({
    logFile: '/tmp/solution-draft-log-pr-1781180521736.txt',
    isPublic: true,
    description: 'Solution draft log for https://github.com/lefinepro/kefine/pull/173',
    mode: 'auto',
    verbose: true,
  });

  assert.deepEqual(args, ['/tmp/solution-draft-log-pr-1781180521736.txt', '--public', '--auto', '--shared-repository', '--description', 'Solution draft log for https://github.com/lefinepro/kefine/pull/173', '--verbose']);
  assert.equal(args.includes('--only-repository'), false);
  assert.equal(args.includes('--only-gist'), false);
  assert.equal(args.includes('--no-shared-repository'), false);
});

test('issue #1902: dedicated repository mode requires an explicit no-shared option', () => {
  const args = buildGhUploadLogArgs({
    logFile: '/tmp/solution-draft-log-pr-large.txt',
    isPublic: false,
    description: 'Solution draft log for https://github.com/link-assistant/hive-mind/pull/1909',
    mode: 'repository',
    useSharedRepository: false,
    verbose: false,
  });

  assert.deepEqual(args, ['/tmp/solution-draft-log-pr-large.txt', '--private', '--only-repository', '--no-shared-repository', '--description', 'Solution draft log for https://github.com/link-assistant/hive-mind/pull/1909']);
  assert.equal(args.includes('--only-gist'), false);
});
