/**
 * @hive-mind-test-suite default
 *
 * Issue #2293, item 2: every auto-restart reason must come with evidence.
 *
 * link-foundation/meta-language pull request 196 restarted five times with
 * "**Reason:** CI failures detected" and nothing else, about one hour per
 * session, on the same failing `Full Requirements Aggregate` check. Nobody
 * could tell from the pull request which check failed, where its run was, or
 * that it was the same failure every time. The restart comment and the log now
 * name each failing check with its run URL, quote the comment or issue edit
 * that triggered the restart, and say when the same checks failed again.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildCiEvidence, buildCommentEvidence, buildIssueEditEvidence, ciFailureSignature, collectRestartEvidence, createCiFailureRepeatTracker, formatReasonWithEvidence } from '../src/restart-evidence.lib.mjs';
import { buildAutoRestartComment } from '../src/auto-restart-exhaustion.lib.mjs';

const RUN_URL = 'https://github.com/link-foundation/meta-language/actions/runs/1795/job/1';
const ciBlocker = (names = ['Full Requirements Aggregate']) => ({
  type: 'ci_failure',
  message: 'CI/CD checks are failing',
  details: names,
  checks: names.map((name, index) => ({ name, conclusion: 'failure', html_url: index === 0 ? RUN_URL : null })),
});

test('CI evidence names each failing check with its run URL', () => {
  assert.deepEqual(buildCiEvidence(ciBlocker(['Full Requirements Aggregate', 'lint'])), [`Failing check: Full Requirements Aggregate — ${RUN_URL}`, 'Failing check: lint']);
  // A blocker without check objects (older shape, or a workflow-file error) still yields evidence.
  assert.deepEqual(buildCiEvidence({ message: 'CI/CD workflow file is invalid', details: [] }), ['CI/CD workflow file is invalid']);
  assert.deepEqual(buildCiEvidence({ details: ['build'] }), ['Failing check: build']);
  assert.deepEqual(buildCiEvidence(null), []);
});

test('comment and issue edit evidence: who, when, where, what', () => {
  const comments = [{ user: { login: 'konard' }, created_at: '2026-09-24T18:24:36Z', html_url: 'https://github.com/o/r/pull/196#issuecomment-1', body: 'Please also   support\nKotlin. '.padEnd(130, '!') }];
  const [line] = buildCommentEvidence(comments);
  assert.match(line, /^Comment by konard at 2026-09-24T18:24:36Z — https:\/\/github.com\/o\/r\/pull\/196#issuecomment-1: "Please also support Kotlin\. !+…"$/);
  const edits = buildIssueEditEvidence(195, [
    { field: 'title', from: 'Old title', to: 'New title' },
    { field: 'body', from: 'line one\n', to: 'line one\nadded line\n' },
  ]);
  assert.equal(edits[0], 'Issue #195 title changed: "Old title" → "New title"');
  assert.match(edits[1], /^Issue #195 description changed: \+1\/-0 lines/);
  assert.match(edits[1], /added line/);
});

test('the same failing checks are recognised across restarts, in any order', () => {
  assert.equal(ciFailureSignature(ciBlocker(['b', 'a', 'a'])), 'a | b');
  assert.equal(ciFailureSignature({ details: ['b — https://x', 'a'] }), 'a | b');
  assert.equal(ciFailureSignature(null), null);
  const tracker = createCiFailureRepeatTracker();
  assert.equal(tracker.record(ciBlocker(['b', 'a'])), 1);
  assert.equal(tracker.record(ciBlocker(['a', 'b'])), 2);
  assert.equal(tracker.record(ciBlocker(['a', 'b'])), 3);
  assert.equal(tracker.record(ciBlocker(['c'])), 1, 'other checks start a new streak');
  assert.equal(tracker.record(null), 0, 'a restart for another reason ends the streak');
  assert.equal(tracker.record(ciBlocker(['c'])), 1);
});

test('the meta-language 196 replay: five CI restarts, each with evidence, the repetition flagged', () => {
  const tracker = createCiFailureRepeatTracker();
  const bodies = [];
  const feedback = [];
  for (let restart = 1; restart <= 5; restart++) {
    const evidence = collectRestartEvidence({ ciBlocker: ciBlocker(), tracker });
    feedback.push(evidence.feedback);
    bodies.push(buildAutoRestartComment({ label: `${restart}/5`, reason: formatReasonWithEvidence('CI failures detected', evidence) }));
  }
  for (const body of bodies) {
    assert.match(body, /\*\*Reason:\*\* CI failures detected/);
    assert.ok(body.includes(`- Failing check: Full Requirements Aggregate — ${RUN_URL}`), body);
  }
  assert.ok(!bodies[0].includes('restarts in a row'), 'the first restart is no repetition');
  assert.deepEqual(feedback[0], []);
  assert.ok(bodies[1].includes('⚠️ The same checks have been failing for 2 restarts in a row.'));
  assert.ok(bodies[4].includes('⚠️ The same checks have been failing for 5 restarts in a row.'));
  assert.match(feedback[4].join('\n'), /same checks have failed 5 restarts in a row/);
});

test('comments, issue edits and CI failures are collected together, capped for the comment', () => {
  const comments = Array.from({ length: 25 }, (_, index) => ({ user: { login: `u${index}` }, created_at: '2026-09-24T18:24:36Z', body: 'x' }));
  const evidence = collectRestartEvidence({ comments, issueNumber: 195, issueChanges: [{ field: 'title', from: 'a', to: 'b' }], ciBlocker: ciBlocker(), tracker: createCiFailureRepeatTracker() });
  assert.equal(evidence.lines.length, 27);
  assert.equal(evidence.repeatedCiFailures, 1);
  const reason = formatReasonWithEvidence('New comment(s)', evidence);
  assert.ok(reason.startsWith('New comment(s)\n\n**Evidence:**\n- Comment by u0'));
  assert.ok(reason.includes('- …and 7 more'));
  assert.equal(formatReasonWithEvidence('Merge conflicts detected', collectRestartEvidence({})), 'Merge conflicts detected');
});

test('wiring: the blocker keeps run URLs and the auto-restart loop logs and posts the evidence', () => {
  const helpers = readFileSync(new URL('../src/solve.auto-merge-helpers.lib.mjs', import.meta.url), 'utf8');
  assert.match(helpers, /checks: actionableFailedChecks\.map\(c => \(\{ name: c\.name, conclusion: c\.conclusion \|\| null, html_url: c\.html_url \|\| null \}\)\)/);
  // `details` stays the plain check names: detectPreExistingCiFailures matches on them.
  assert.match(helpers, /details: actionableFailedChecks\.map\(c => c\.name\),/);
  const loop = readFileSync(new URL('../src/solve.auto-merge.lib.mjs', import.meta.url), 'utf8');
  assert.match(loop, /collectRestartEvidence\(\{/);
  assert.match(loop, /createCiFailureRepeatTracker\(\)/);
  assert.match(loop, /formatAligned\('', 'Evidence:', line, 2\)/);
  assert.match(loop, /buildAutoRestartComment\(\{ label: formatAutoRestartLabel\(restartCount\), reason: formatReasonWithEvidence\(restartReason, restartEvidence\) \}\)/);
});
