#!/usr/bin/env node
/** Issue #3359: close a parent whose work is complete; otherwise explain on it why it stays open. */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeGitHub } from '../experiments/issue-3354/fake-github.mjs';
import { PARENT_STATUS_MARKER, closeCompletedParents, evaluateParentCompletion } from '../src/close-completed-parents.lib.mjs';

const closed = (at, reason = 'completed') => ({ state: 'closed', state_reason: reason, closed_at: at });

/** link-assistant/agent#300 with sub-issues #301 to #303 (all closed as completed), under link-assistant/hive-mind#3282. */
const tree = ({ body = '- [x] parser\n- [x] worker\n\n## Done when\n\n- [x] tests pass', parent = {}, subs = {} } = {}) =>
  createFakeGitHub({
    issues: {
      'link-assistant/hive-mind#3282': { state: 'open', sub: ['link-assistant/agent#300', 'link-assistant/hive-mind#3283'], body: '' },
      'link-assistant/hive-mind#3283': { state: 'open', parent: 'link-assistant/hive-mind#3282' },
      'link-assistant/agent#300': { state: 'open', body, parent: 'link-assistant/hive-mind#3282', sub: ['link-assistant/agent#301', 'link-assistant/agent#302', 'link-assistant/agent#303'], ...parent },
      'link-assistant/agent#301': { ...closed('2026-10-01T00:00:00Z'), parent: 'link-assistant/agent#300' },
      'link-assistant/agent#302': { ...closed('2026-10-02T00:00:00Z'), parent: 'link-assistant/agent#300' },
      'link-assistant/agent#303': { ...closed('2026-10-03T00:00:00Z'), parent: 'link-assistant/agent#300', ...subs },
    },
  });

test('3 completed sub-issues and a fully checked list: the parent is closed, the grandparent with an open sub-issue is not', async () => {
  const fake = tree();
  const result = await closeCompletedParents(['link-assistant/agent#303'], { run: fake.run });
  assert.deepEqual(result, { closed: ['link-assistant/agent#300'], wouldClose: [], keptOpen: [], failed: [] });
  assert.equal(fake.issue('link-assistant/agent#300').state, 'closed');
  assert.match(fake.issue('link-assistant/agent#300').comments[0].body, /^All 3 sub-issues are closed as completed/);
  // The umbrella still has an open sub-issue: it stays open, silently (the "applied to a real tree" check for #3282).
  assert.equal(fake.issue('link-assistant/hive-mind#3282').state, 'open');
  assert.equal(fake.issue('link-assistant/hive-mind#3282').comments, undefined);
  // Sub-issues are never closed because a parent closed.
  assert.equal(fake.issue('link-assistant/hive-mind#3283').state, 'open');
  assert.deepEqual(fake.closeCalls(), ['link-assistant/agent#300']);
});

test('report mode closes nothing', async () => {
  const fake = tree();
  const result = await closeCompletedParents(['link-assistant/agent#303'], { run: fake.run, mode: 'report' });
  assert.deepEqual(result.wouldClose, ['link-assistant/agent#300']);
  assert.deepEqual(fake.closeCalls(), []);
});

test('one "- [ ]" left: a status comment instead, updated (not duplicated) on the next run', async () => {
  const fake = tree({ body: '- [x] parser\n- [ ] worker' });
  const first = await closeCompletedParents(['link-assistant/agent#303'], { run: fake.run });
  assert.deepEqual(first.closed, []);
  assert.deepEqual(first.keptOpen, [{ key: 'link-assistant/agent#300', reasons: ['the description has unchecked task-list items'] }]);
  const parent = fake.issue('link-assistant/agent#300');
  assert.equal(parent.state, 'open');
  assert.equal(parent.comments.length, 1);
  assert.equal(parent.comments[0].body, `${PARENT_STATUS_MARKER}\nAll 3 sub-issues are closed; still open because: the description has unchecked task-list items.`);
  parent.body = '- [x] parser\n- [ ] worker\n\n## Done when\n\n- Benchmarks pass (open)';
  await closeCompletedParents(['link-assistant/agent#303'], { run: fake.run });
  assert.equal(parent.comments.length, 1);
  assert.match(parent.comments[0].body, /unchecked task-list items; 1 "Done when" item\(s\) marked open\.$/);
  assert.ok(fake.calls.some(args => args[0] === 'api' && args[2] === 'PATCH'));
});

test('a parent reopened by a person after its last sub-issue closed stays open; a bot reopen does not count', async () => {
  const human = tree({ parent: { reopened: [{ login: 'konard', type: 'User', at: '2026-10-04T00:00:00Z' }] } });
  const result = await closeCompletedParents(['link-assistant/agent#303'], { run: human.run });
  assert.deepEqual(result.closed, []);
  assert.deepEqual(result.keptOpen[0].reasons, ['reopened by @konard after the last sub-issue closed']);
  assert.equal(human.issue('link-assistant/agent#300').state, 'open');
  const earlier = tree({ parent: { reopened: [{ login: 'konard', type: 'User', at: '2026-09-01T00:00:00Z' }] } });
  assert.deepEqual((await closeCompletedParents(['link-assistant/agent#303'], { run: earlier.run })).closed, ['link-assistant/agent#300']);
  const bot = tree({ parent: { reopened: [{ login: 'github-actions', type: 'Bot', at: '2026-10-04T00:00:00Z' }] } });
  assert.deepEqual((await closeCompletedParents(['link-assistant/agent#303'], { run: bot.run })).closed, ['link-assistant/agent#300']);
});

test('not planned counts only if the parent body says so; an open blocker keeps the parent open', async () => {
  const notPlanned = tree({ subs: closed('2026-10-03T00:00:00Z', 'not_planned') });
  const kept = await closeCompletedParents(['link-assistant/agent#303'], { run: notPlanned.run });
  assert.deepEqual(kept.keptOpen[0].reasons, ['link-assistant/agent#303 (not planned) not closed as completed, and the description does not accept that']);
  const accepted = tree({ body: '- [x] parser\n- #303 is not planned: the worker is out of scope.', subs: closed('2026-10-03T00:00:00Z', 'not_planned') });
  assert.deepEqual((await closeCompletedParents(['link-assistant/agent#303'], { run: accepted.run })).closed, ['link-assistant/agent#300']);
  const blocked = tree({ parent: { blockedBy: ['link-assistant/hive-mind#3283'] } });
  assert.deepEqual((await closeCompletedParents(['link-assistant/agent#303'], { run: blocked.run })).keptOpen[0].reasons, ['blocked by open link-assistant/hive-mind#3283']);
});

test('read failures fail closed and are reported', async () => {
  const fake = tree();
  const result = await closeCompletedParents(['link-assistant/agent#999'], { run: fake.run });
  assert.equal(result.failed[0].key, 'link-assistant/agent#999');
  assert.deepEqual(fake.closeCalls(), []);
  assert.equal(evaluateParentCompletion({ body: '', repository: { nameWithOwner: 'o/r' }, subIssues: { nodes: [] }, blockedBy: { nodes: [] }, timelineItems: { nodes: [] } }).complete, false);
});
