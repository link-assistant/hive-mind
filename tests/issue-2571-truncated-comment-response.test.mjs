/**
 * @hive-mind-test-suite default
 *
 * Issue #2571: the production log ends a session with
 *   unexpected end of JSON input
 *   ❌ Failed to post comment with log link: unexpected end of JSON input
 * gh could not parse GitHub's cut-off reply, so the comment may or may not have
 * been created. postTrackedComment now looks before posting again.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { postTrackedComment } from '../src/tool-comments.lib.mjs';

const TRUNCATED = { code: 1, stdout: '', stderr: 'unexpected end of JSON input' };

function fakeGh(responses) {
  const calls = [];
  const $ =
    options =>
    async (strings, ...values) => {
      const command = strings.reduce((text, part, index) => text + part + (index < values.length ? values[index] : ''), '');
      calls.push({ command, stdin: options?.stdin });
      const next = responses.shift();
      return typeof next === 'function' ? next(command, options) : next;
    };
  return { $, calls };
}

const post = $ => postTrackedComment({ $, owner: 'o', repo: 'r', targetNumber: 7, body: '## Solution Draft Log\nlink' });

test('a comment that was created despite the cut-off reply is not posted twice', async () => {
  const { $, calls } = fakeGh([
    TRUNCATED,
    {
      code: 0,
      stdout: JSON.stringify([
        { id: 1, body: 'other' },
        { id: 42, body: '## Solution Draft Log\nlink' },
      ]),
    },
  ]);
  assert.deepEqual(await post($), { ok: true, commentId: '42' });
  assert.equal(calls.length, 2);
  assert.match(calls[1].command, /^gh api repos\/o\/r\/issues\/7\/comments\?since=\S+&per_page=100$/);
});

test('a comment that was not created is posted again once', async () => {
  const { $, calls } = fakeGh([TRUNCATED, { code: 0, stdout: '[]' }, { code: 0, stdout: '{"id":43}' }]);
  assert.deepEqual(await post($), { ok: true, commentId: '43' });
  assert.equal(calls.filter(call => call.command.includes('-X POST')).length, 2);
});

test('when GitHub cannot be asked, the failure is reported rather than risking a duplicate', async () => {
  const { $, calls } = fakeGh([TRUNCATED, { code: 1, stdout: '', stderr: 'HTTP 502' }]);
  const result = await post($);
  assert.equal(result.ok, false);
  assert.match(result.stderr, /unexpected end of JSON input/);
  assert.equal(calls.length, 2);
});

test('other failures are not retried', async () => {
  const { $, calls } = fakeGh([{ code: 1, stdout: '', stderr: 'HTTP 404: Not Found' }]);
  assert.equal((await post($)).ok, false);
  assert.equal(calls.length, 1);
});
