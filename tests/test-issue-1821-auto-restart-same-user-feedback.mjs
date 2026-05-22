#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression test for issue #1821: auto-restart must not hide a human
 * feedback comment just because it was posted by the same GitHub account that
 * is running hive-mind. Tool-generated comments from that account are filtered
 * by markers instead.
 */

import assert from 'node:assert/strict';

import { checkForNonBotComments } from '../src/solve.auto-merge-helpers.lib.mjs';

const response = value => ({
  code: 0,
  stdout: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)),
  stderr: Buffer.from(''),
});

const commandText = (strings, values) => strings.reduce((acc, part, index) => acc + part + (index < values.length ? String(values[index]) : ''), '');

const createFakeGh = ({ prComments, reviewComments = [] }) => {
  const calls = [];
  const fakeGh = async (strings, ...values) => {
    const command = commandText(strings, values);
    calls.push(command);

    if (command === 'gh api user --jq .login') {
      return response('konard\n');
    }
    if (command === 'gh api repos/link-assistant/formal-ai/issues/222/comments --paginate') {
      return response(prComments);
    }
    if (command === 'gh api repos/link-assistant/formal-ai/pulls/222/comments --paginate') {
      return response(reviewComments);
    }

    throw new Error(`Unexpected command in test: ${command}`);
  };
  fakeGh.calls = calls;
  return fakeGh;
};

const lastCheckTime = new Date('2026-05-22T13:04:21Z');

const incidentComments = [
  {
    id: 4518895370,
    created_at: '2026-05-22T13:03:59Z',
    user: { login: 'konard' },
    body: 'Old same-user comment before the check window',
  },
  {
    id: 4518897330,
    created_at: '2026-05-22T13:04:33Z',
    user: { login: 'konard' },
    body: '## Solution Draft Log\n\nNow working session is ended',
  },
  {
    id: 4518909964,
    created_at: '2026-05-22T13:06:01Z',
    user: { login: 'konard' },
    body: 'We should not encode raw API data in .lino files as base64, it should be all human readable.',
  },
  {
    id: 4518934890,
    created_at: '2026-05-22T13:08:55Z',
    user: { login: 'konard' },
    body: '## Auto-restart triggered (iteration 1)\n\nReason: CI failures detected',
  },
  {
    id: 4518939999,
    created_at: '2026-05-22T13:09:00Z',
    user: { login: 'github-actions[bot]' },
    body: 'CI failed',
  },
];

{
  const fakeGh = createFakeGh({ prComments: incidentComments });
  const result = await checkForNonBotComments('link-assistant', 'formal-ai', 222, 222, lastCheckTime, false, fakeGh);

  assert.equal(result.hasNewComments, true, 'same-account human feedback must trigger auto-restart');
  assert.equal(result.comments.length, 1, 'only the human feedback comment should remain after filtering');
  assert.equal(result.comments[0].id, 4518909964);
  assert.match(result.comments[0].body, /should not encode raw API data/);
}

{
  const fakeGh = createFakeGh({
    prComments: incidentComments.filter(comment => comment.id !== 4518909964),
  });
  const result = await checkForNonBotComments('link-assistant', 'formal-ai', 222, 222, lastCheckTime, false, fakeGh);

  assert.equal(result.hasNewComments, false, 'same-account tool comments alone must not trigger auto-restart');
  assert.deepEqual(result.comments, []);
}

console.log('Issue #1821 same-account auto-restart feedback regression tests passed');
