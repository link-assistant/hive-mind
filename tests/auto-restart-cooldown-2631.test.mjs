/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRestartCooldownMarker, checkPullRequestRestartCooldown, evaluateRestartCooldown } from '../src/auto-restart-cooldown.lib.mjs';
import { buildAutoRestartLimitComment } from '../src/auto-restart-exhaustion.lib.mjs';

const headSha = 'a'.repeat(40);
const stoppedAt = '2026-10-07T10:00:00Z';
const now = Date.parse('2026-10-07T11:00:00Z');
const comments = [{ body: buildRestartCooldownMarker(headSha), created_at: stoppedAt }];

test('exhaustion summary names failing jobs and persists the PR commit for cooldown', () => {
  const body = buildAutoRestartLimitComment({ label: '5/5', blocker: 'CI failed: ESLint, Tests', preservedText: 'Work pushed to recovery/task.', headSha });
  assert.match(body, /CI failed: ESLint, Tests/);
  assert.match(body, /Work pushed to recovery\/task/);
  assert.ok(evaluateRestartCooldown({ headSha, comments: [{ body, created_at: stoppedAt }], now }));
});

test('exhaustion cooldown survives a new worker and ignores automated bookkeeping', () => {
  assert.ok(evaluateRestartCooldown({ headSha, comments, now }));
  assert.ok(evaluateRestartCooldown({ headSha, comments: [...comments, { body: 'AI Work Session Started', created_at: '2026-10-07T10:30:00Z' }], now }));
  assert.equal(evaluateRestartCooldown({ headSha, comments, now: now + 6 * 3600000 }), null);
  assert.equal(evaluateRestartCooldown({ headSha: 'b'.repeat(40), comments, now }), null);
});

test('new or edited issue, PR, inline and review feedback release the cooldown', () => {
  for (const timestamp of ['created_at', 'updated_at', 'submitted_at']) {
    assert.equal(evaluateRestartCooldown({ headSha, comments, activity: [{ body: 'Please try this fix', [timestamp]: '2026-10-07T10:30:00Z' }], now }), null);
  }
});

test('GitHub cooldown lookup reads all comment types with pagination', { timeout: 10000 }, async () => {
  const calls = [];
  const result = await checkPullRequestRestartCooldown({
    owner: 'o',
    repo: 'r',
    prNumber: 2,
    issueNumber: 1,
    now,
    env: {},
    runGh: async args => {
      calls.push(args);
      if (args[0] === 'pr') return { headRefOid: headSha };
      if (args[1].endsWith('issues/2/comments')) return [[], comments];
      if (args[1].endsWith('pulls/2/reviews')) return [[{ body: 'Requested changes', submitted_at: '2026-10-07T10:30:00Z' }]];
      return [[]];
    },
  });
  assert.equal(result, null);
  assert.equal(calls.length, 5);
  assert.ok(calls.filter(args => args[0] === 'api').every(args => args.includes('--paginate')));
});
