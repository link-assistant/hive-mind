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

import { buildCiEvidence, buildCommentEvidence, buildIssueEditEvidence, ciFailureOutputSignature, ciFailureSignature, collectRestartEvidence, createCiFailureRepeatTracker, DEFAULT_CI_FAILURE_REPEAT_STOP, formatReasonWithEvidence, normalizeCheckOutput } from '../src/restart-evidence.lib.mjs';
import { buildAutomationStopComment } from '../src/automation-stop-reporting.lib.mjs';
import { buildAutoRestartComment } from '../src/auto-restart-exhaustion.lib.mjs';

const RUN_URL = 'https://github.com/link-foundation/meta-language/actions/runs/1795/job/1';
const ciBlocker = (names = ['Full Requirements Aggregate'], description = null) => ({
  type: 'ci_failure',
  message: 'CI/CD checks are failing',
  details: names,
  checks: names.map((name, index) => ({ name, conclusion: 'failure', html_url: index === 0 ? RUN_URL : null, description })),
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
  assert.match(helpers, /checks: actionableFailedChecks\.map\(c => \(\{ name: c\.name, conclusion: c\.conclusion \|\| null, html_url: c\.html_url \|\| null, description: c\.description \|\| null \}\)\)/);
  // `details` stays the plain check names: detectPreExistingCiFailures matches on them.
  assert.match(helpers, /details: actionableFailedChecks\.map\(c => c\.name\),/);
  const loop = readFileSync(new URL('../src/solve.auto-merge.lib.mjs', import.meta.url), 'utf8');
  assert.match(loop, /collectRestartEvidence\(\{/);
  assert.match(loop, /createCiFailureRepeatTracker\(\{/);
  assert.match(loop, /formatAligned\('', 'Evidence:', line, 2\)/);
  assert.match(loop, /buildAutoRestartComment\(\{ label: formatAutoRestartLabel\(restartCount\), reason: formatReasonWithEvidence\(restartReason, restartEvidence\) \}\)/);
});

test('a repeat is judged on the output too: 11/189 → 150/189 is progress, the same 11/189 three times is not', () => {
  assert.equal(normalizeCheckOutput('11/189 passed in 3m 12s at 2026-09-24T18:30:11Z, run https://x/runs/1 (sha 5da98f8)'), '11/189 passed in at , run (sha )');
  assert.equal(ciFailureOutputSignature(ciBlocker(['b', 'a'], '11/189 passed')), 'a: 11/189 passed | b: 11/189 passed');
  assert.equal(ciFailureOutputSignature(ciBlocker(['a'])), null, 'no output: a repeat cannot be told from progress');
  assert.equal(DEFAULT_CI_FAILURE_REPEAT_STOP, 3);

  const progressing = createCiFailureRepeatTracker();
  for (const passed of [11, 40, 90, 150, 170]) progressing.record(ciBlocker(undefined, `${passed}/189 requirements passed`));
  assert.equal(progressing.shouldStop(), false, 'the same check, failing less every time, never stops the run');

  const silent = createCiFailureRepeatTracker();
  for (let restart = 0; restart < 5; restart++) silent.record(ciBlocker());
  assert.equal(silent.shouldStop(), false, 'a check without output never stops the run');

  const stuck = createCiFailureRepeatTracker();
  const verdicts = [1, 2, 3].map(restart => collectRestartEvidence({ ciBlocker: ciBlocker(undefined, `11/189 requirements passed (took ${restart}m)`), tracker: stuck }));
  assert.deepEqual(
    verdicts.map(({ identicalCiFailures, stop }) => [identicalCiFailures, stop]),
    [
      [1, false],
      [2, false],
      [3, true],
    ]
  );

  const reset = createCiFailureRepeatTracker();
  reset.record(ciBlocker(undefined, 'x'));
  reset.record(ciBlocker(undefined, 'x'));
  reset.record(null);
  assert.equal(reset.record(ciBlocker(undefined, 'x')) && reset.identical(), 1, 'a restart for another reason ends the streak');

  const disabled = createCiFailureRepeatTracker({ stopAfter: 0 });
  for (let restart = 0; restart < 6; restart++) disabled.record(ciBlocker(undefined, 'x'));
  assert.equal(disabled.shouldStop(), false, 'HIVE_MIND_CI_FAILURE_REPEAT_STOP=0 keeps restarting');
});

test('the stop is a terminal failure: named checks on the PR, draft kept, work preserved, non-zero exit', () => {
  const comment = buildAutomationStopComment({ reason: 'repeated_ci_failure', mode: 'auto-restart-until-mergeable', message: 'The same checks failed with the same output after 3 AI sessions in a row.', details: [`Failing check: Full Requirements Aggregate — ${RUN_URL}`] });
  assert.match(comment, /the same CI failure repeated restart after restart/);
  assert.ok(comment.includes(RUN_URL));
  assert.match(comment, /HIVE_MIND_CI_FAILURE_REPEAT_STOP/);
  const loop = readFileSync(new URL('../src/solve.auto-merge.lib.mjs', import.meta.url), 'utf8');
  assert.match(loop, /createCiFailureRepeatTracker\(\{ stopAfter: ciFailureRepeat\.stopAfter \}\)/);
  assert.match(loop, /if \(restartEvidence\.stop\) \{\n\s+const stop = await failOnRepeatedCiFailure\(/);
  const progress = readFileSync(new URL('../src/session-progress.lib.mjs', import.meta.url), 'utf8');
  assert.match(progress, /export const failOnRepeatedCiFailure = [^;]*stopWithoutProgress\(/);
  const finalize = readFileSync(new URL('../src/solve.finalize.lib.mjs', import.meta.url), 'utf8');
  assert.match(finalize, /safeExit\(1, repeatedCi \? 'Same CI failure repeated' : 'No progress between sessions'\)/);
});
