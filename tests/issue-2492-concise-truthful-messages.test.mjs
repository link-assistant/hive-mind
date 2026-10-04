#!/usr/bin/env node

/**
 * Issue #2492: user-facing comments state only what is true when they are posted,
 * and stay short unless the user asked for detail.
 *
 * The reported "AI Work Session Started" comment said "Starting ..." after the
 * fact, claimed "The PR has been converted to draft mode" on a PR that already was
 * a draft, and carried a runtime line (solve version, tool, model, task image
 * digest) that the solution log already records.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2492
 */

import assert from 'node:assert/strict';

import { getSessionCommentContent, postWorkSessionStartComment, SESSION_TYPES, shouldPublishSessionRuntime } from '../src/solve.session.lib.mjs';

const AT = new Date('2026-10-04T12:00:55.290Z');
const RUNTIME = '_Runtime: solve `v2.33.11` · tool `claude` · model `opus`_';

// ---------------------------------------------------------------------------
// 1. Session start comments: past tense, no unchecked draft claim, short.
// ---------------------------------------------------------------------------

for (const type of Object.values(SESSION_TYPES)) {
  const { description } = getSessionCommentContent(type, AT);
  assert.doesNotMatch(description, /converted to draft/i, `${type}: the draft change is shown by GitHub, and may not have happened`);
  assert.doesNotMatch(description, /^(Starting|Resuming|Auto-resuming|Auto-restarting)/, `${type}: the comment is posted after the session started`);
  assert.doesNotMatch(description, /Runtime:/, `${type}: no runtime line by default`);
  assert.match(description, /2026-10-04T12:00:55\.290Z/, `${type}: the start time is stated`);
  assert.ok(description.length <= 160, `${type}: concise (${description.length} chars): ${description}`);
}

assert.equal(getSessionCommentContent(SESSION_TYPES.NEW, AT).description, 'Started at 2026-10-04T12:00:55.290Z. Please wait for it to finish before giving feedback.');
assert.match(getSessionCommentContent(SESSION_TYPES.AUTO_RESUME, AT).description, /previous context kept/);
assert.match(getSessionCommentContent(SESSION_TYPES.AUTO_RESTART, AT).description, /fresh context/);
assert.match(getSessionCommentContent(SESSION_TYPES.NEW, AT, RUNTIME).description, /\n\n_Runtime: solve/, 'an explicitly passed runtime line is appended');

// ---------------------------------------------------------------------------
// 2. The runtime line reaches GitHub only with --verbose; it is always logged.
// ---------------------------------------------------------------------------

assert.equal(shouldPublishSessionRuntime(null), false);
assert.equal(shouldPublishSessionRuntime({}), false);
assert.equal(shouldPublishSessionRuntime({ attachLogs: true }), false, 'the attached log already contains it');
assert.equal(shouldPublishSessionRuntime({ verbose: true }), true);

const postStart = async argv => {
  let body = null;
  const logLines = [];
  const $ = options => () => {
    body = JSON.parse(options.stdin).body;
    return Promise.resolve({ code: 0, stdout: Buffer.from('{"id":1}'), stderr: Buffer.from('') });
  };
  await postWorkSessionStartComment({
    owner: 'o',
    repo: 'r',
    prNumber: 1,
    $,
    log: async line => logLines.push(line),
    formatAligned: (...parts) => parts.join(' '),
    sessionType: SESSION_TYPES.NEW,
    timestamp: AT,
    argv,
    resolveRuntime: async () => ({ line: RUNTIME }),
  });
  return { body, logLines };
};

const quiet = await postStart({ tool: 'claude', model: 'opus' });
assert.equal(quiet.body, '🤖 **AI Work Session Started**\n\nStarted at 2026-10-04T12:00:55.290Z. Please wait for it to finish before giving feedback.');
assert.ok(
  quiet.logLines.some(line => line.includes('Runtime:') && line.includes('solve `v2.33.11`')),
  'the runtime still goes to the log'
);

const verbose = await postStart({ tool: 'claude', model: 'opus', verbose: true });
assert.match(verbose.body, /_Runtime: solve `v2\.33\.11`/);

console.log('PASS: issue #2492 session comments are short and claim only checked facts');
