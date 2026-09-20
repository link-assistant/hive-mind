/**
 * @hive-mind-test-suite default
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildGhUploadLogArgs } from '../src/log-upload.lib.mjs';

test('issue #1902: default log uploads rely on gh-upload-log auto mode defaults', () => {
  const args = buildGhUploadLogArgs({
    logFile: '/tmp/solution-draft-log-pr-1781180521736.txt',
    isPublic: true,
    description: 'Solution draft log for https://github.com/lefinepro/kefine/pull/173',
    verbose: true,
  });

  assert.deepEqual(args, ['/tmp/solution-draft-log-pr-1781180521736.txt', '--public', '--description', 'Solution draft log for https://github.com/lefinepro/kefine/pull/173', '--verbose']);
  assert.equal(args.includes('--auto'), false);
  assert.equal(args.includes('--shared-repository'), false);
  assert.equal(args.includes('--only-repository'), false);
  assert.equal(args.includes('--only-gist'), false);
  assert.equal(args.includes('--no-shared-repository'), false);
});

test('issue #1902: private default log uploads also avoid explicit repository mode flags', () => {
  const args = buildGhUploadLogArgs({
    logFile: '/tmp/solution-draft-log-pr-large.txt',
    isPublic: false,
    description: 'Solution draft log for https://github.com/link-assistant/hive-mind/pull/1909',
    verbose: false,
  });

  assert.deepEqual(args, ['/tmp/solution-draft-log-pr-large.txt', '--private', '--description', 'Solution draft log for https://github.com/link-assistant/hive-mind/pull/1909']);
  assert.equal(args.includes('--auto'), false);
  assert.equal(args.includes('--shared-repository'), false);
  assert.equal(args.includes('--only-repository'), false);
  assert.equal(args.includes('--only-gist'), false);
  assert.equal(args.includes('--no-shared-repository'), false);
});
