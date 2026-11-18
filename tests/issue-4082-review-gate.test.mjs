#!/usr/bin/env node
/**
 * Issue #4082, cases 2 and 6, plus the watch-loop wiring of cases 1–5.
 *
 *   2. A review bot re-reviewed about an hour after "✅ Ready to merge", but
 *      the `--auto-restart-until-mergeable` loop had already exited.
 *   6. A session summary said "merge the companion PR first", yet the final
 *      comment was "✅ Ready to merge" with no word about the order.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4082
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_REVIEW_WINDOW_MINUTES, READY_FOR_REVIEW_BLOCKED_SIGNATURE, buildReadyForReviewBlockedComment, createReviewGate, normalizeReviewWindowMinutes, resolveReviewGateOptions } from '../src/solve.auto-merge-review-gate.lib.mjs';
import { checkMergePrerequisites, checkReferenceState, extractReferences, findMergePrerequisiteDeclarations, formatPrerequisitesForComment, latestSessionSummary, stripHtmlComments } from '../src/merge-prerequisites.lib.mjs';
import { SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';
import { buildReadyForReviewComment } from '../src/external-review-limit.lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'link-foundation';
const REPO = 'example';
const PR = 12;
const ISSUE = 11;
const CONTEXT = { owner: OWNER, repo: REPO, selfNumbers: [PR, ISSUE] };

const response = (value, code = 0) => ({ code, stdout: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)), stderr: Buffer.from('') });
const commandText = (strings, values) => strings.reduce((acc, part, index) => acc + part + (index < values.length ? String(values[index]) : ''), '');
const declared = text => findMergePrerequisiteDeclarations(text, CONTEXT).map(declaration => declaration.references.map(ref => `${ref.owner}/${ref.repo}#${ref.number}`));

test('case 6: merge-order declarations are found, with or without a link', () => {
  assert.deepEqual(declared('Merge the companion PR in the other repository first.'), [[]]);
  assert.deepEqual(declared('Please merge https://github.com/other/lib/pull/3 first'), [['other/lib#3']]);
  assert.deepEqual(declared('Depends on other/lib#5'), [['other/lib#5']]);
  assert.deepEqual(declared('- Blocked by #20'), [[`${OWNER}/${REPO}#20`]]);
  assert.deepEqual(declared('Do not merge before #7 lands'), [[`${OWNER}/${REPO}#7`]]);
  assert.deepEqual(declared('#8 must be merged first.'), [[`${OWNER}/${REPO}#8`]]);
  assert.deepEqual(declared('Merge this PR only after the release is cut.'), [[]]);
  assert.deepEqual(declared('This can land after other/lib#9 is merged.'), [['other/lib#9']]);
});

test('case 6: ordinary prose, closing keywords, quotes, code and self-references are not prerequisites', () => {
  for (const text of ['The result depends on the flag value.', 'I merged the default branch first.', 'Fixes #11', 'This PR does not need to be merged first.', 'No prerequisites.', '> Depends on #30', '```\nDepends on #30\n```', '<!-- Blocked by #30 -->', 'See `Depends on #30` in the template.', 'Depends on #12', 'Requires #31']) {
    assert.deepEqual(findMergePrerequisiteDeclarations(text, CONTEXT), [], text);
  }
});

test('case 6: nested or unterminated HTML comments cannot leak into the status comment (CodeQL js/incomplete-multi-character-sanitization)', () => {
  assert.equal(stripHtmlComments('a <!-- x --> b'), 'a  b');
  assert.equal(stripHtmlComments('a <!<!-- x -->-- hidden\nDepends on #30'), 'a ');
  assert.equal(stripHtmlComments('a <!-- never closed\nDepends on #30'), 'a ');
  assert.ok(!stripHtmlComments('<!<!--<!-- -->-->--x').includes('<!--'));
  assert.deepEqual(findMergePrerequisiteDeclarations('Merge other/lib#3 first <!<!-- x -->-- Depends on #30', CONTEXT), [{ text: 'Merge other/lib#3 first', references: [{ owner: 'other', repo: 'lib', number: 3 }] }]);
  assert.equal(stripHtmlComments(null), '');
});

test('case 6: references are read from URLs, owner/repo#N and #N', () => {
  assert.deepEqual(extractReferences('see https://github.com/a/b/issues/4, c/d#5 and #6 (#6 again)', { owner: 'o', repo: 'r' }), [
    { owner: 'a', repo: 'b', number: 4 },
    { owner: 'c', repo: 'd', number: 5 },
    { owner: 'o', repo: 'r', number: 6 },
  ]);
});

test('case 6: the latest session summary is the one that counts', () => {
  const comments = [{ body: '## Working session summary\n\nMerge other/lib#1 first.' }, { body: 'unrelated' }, { body: '## Working session summary\n\nAll done.' }];
  assert.match(latestSessionSummary(comments), /All done/);
  assert.equal(latestSessionSummary([]), '');
});

const githubWith = ({ prBody = '', comments = [], states = {} }) => {
  const calls = [];
  const $ = async (strings, ...values) => {
    const command = commandText(strings, values);
    calls.push(command);
    if (command === `gh api repos/${OWNER}/${REPO}/pulls/${PR}`) return response({ body: prBody });
    if (command === `gh api repos/${OWNER}/${REPO}/issues/${PR}/comments --paginate`) return response(comments);
    const match = command.match(/^gh api repos\/([^/]+)\/([^/]+)\/issues\/(\d+)$/);
    if (match) {
      const state = states[`${match[1]}/${match[2]}#${match[3]}`];
      return state ? response({ ...state, html_url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`, title: 'Companion' }) : response('Not Found', 1);
    }
    return response('[]');
  };
  return { $, calls };
};

test('case 6: a pull request prerequisite is met only once merged; an issue once closed; an unreadable one never', async () => {
  const merged = { pull_request: { merged_at: '2026-11-10T00:00:00Z' }, state: 'closed' };
  const closedUnmerged = { pull_request: { merged_at: null }, state: 'closed' };
  const { $ } = githubWith({ states: { 'a/b#1': merged, 'a/b#2': closedUnmerged, 'a/b#3': { state: 'closed' }, 'a/b#4': { state: 'open' } } });
  const state = async number => (await checkReferenceState({ owner: 'a', repo: 'b', number }, $)).resolved;
  assert.deepEqual([await state(1), await state(2), await state(3), await state(4), await state(5)], [true, false, true, false, false]);
});

test('case 6: prerequisites from the description and the latest session summary are checked and named', async () => {
  const { $, calls } = githubWith({
    prBody: '## Summary\n\nDepends on other/lib#5\n\nFixes #11',
    comments: [{ body: '## Working session summary\n\nMerge the companion PR in the other repository first.\nAlso blocked by other/lib#5.' }],
    states: { 'other/lib#5': { pull_request: { merged_at: null }, state: 'open' } },
  });
  const result = await checkMergePrerequisites({ owner: OWNER, repo: REPO, prNumber: PR, issueNumber: ISSUE, commandRunner: $ });
  assert.equal(result.ok, true);
  assert.equal(result.unresolved.length, 3);
  assert.equal(calls.filter(command => command === 'gh api repos/other/lib/issues/5').length, 1, 'each reference is read once');
  const lines = formatPrerequisitesForComment(result.unresolved);
  assert.match(lines[0], /Declared in the pull request description: "Depends on other\/lib#5" — \[other\/lib#5\]\(https:\/\/github\.com\/other\/lib\/pull\/5\) is open and not merged/);
  assert.match(lines[1], /working session summary: "Merge the companion PR in the other repository first\." — no link to check, so confirm it manually/);

  const done = githubWith({ prBody: 'Depends on other/lib#5', states: { 'other/lib#5': { pull_request: { merged_at: '2026-11-10T00:00:00Z' }, state: 'closed' } } });
  assert.deepEqual((await checkMergePrerequisites({ owner: OWNER, repo: REPO, prNumber: PR, issueNumber: ISSUE, commandRunner: done.$ })).unresolved, []);
});

test('case 6: unmet prerequisites replace "Ready to merge" with "Ready for review — blocked by …"', async () => {
  const { $ } = githubWith({ prBody: 'Merge other/lib#5 first.', states: { 'other/lib#5': { pull_request: { merged_at: null }, state: 'open' } } });
  const gate = createReviewGate({ owner: OWNER, repo: REPO, prNumber: PR, issueNumber: ISSUE, commandRunner: $, options: resolveReviewGateOptions({}) });
  const holds = await gate.collectHolds({ alreadyReported: [{ id: 'T1', author: 'chatgpt-codex-connector[bot]', path: 'a.mjs', line: 3, url: 'https://example.test/r1' }] });
  assert.deepEqual(
    holds.map(hold => hold.reason),
    ['unresolved_review_threads', 'merge_prerequisite']
  );
  const body = buildReadyForReviewBlockedComment({ holds, ciLine: '- All CI checks have passed' });
  assert.ok(body.startsWith(`${READY_FOR_REVIEW_BLOCKED_SIGNATURE} unresolved review threads and merge prerequisites`), body);
  assert.doesNotMatch(body, /Ready to merge/);
  assert.match(body, /other\/lib#5/);
  assert.match(body, /chatgpt-codex-connector\[bot\] on `a\.mjs:3`/);
  const blockers = gate.holdsAsMergeBlockers(holds);
  assert.deepEqual(
    blockers.map(blocker => blocker.reason),
    ['unresolved_review_threads', 'merge_prerequisite']
  );

  const off = createReviewGate({ owner: OWNER, repo: REPO, prNumber: PR, issueNumber: ISSUE, commandRunner: $, options: resolveReviewGateOptions({ checkMergePrerequisites: false }) });
  assert.deepEqual(await off.collectHolds({ alreadyReported: [] }), []);
});

test('case 6: the external-review-limit "Ready for review" dedup does not mistake the blocked comment for its own', () => {
  const source = readFileSync(join(root, 'src', 'solve.auto-merge.lib.mjs'), 'utf8');
  const signature = '## 🟡 Ready for review\n';
  assert.ok(source.includes('const commentSignature = `## 🟡 ${READY_FOR_REVIEW_MARKER}\\n`;'));
  assert.ok(buildReadyForReviewComment({ blocker: { details: [] }, ciStatus: {} }).includes(signature));
  assert.ok(!buildReadyForReviewBlockedComment({ holds: [{ title: 'Merge prerequisites', items: ['- x'] }], ciLine: '' }).includes(signature));
});

test('case 2: the review window keeps the loop watching after "Ready to merge", and restarts reopen it', () => {
  assert.equal(DEFAULT_REVIEW_WINDOW_MINUTES, 120);
  assert.equal(SOLVE_OPTION_DEFINITIONS['auto-restart-until-mergeable-review-window-minutes'].default, DEFAULT_REVIEW_WINDOW_MINUTES);
  assert.equal(SOLVE_OPTION_DEFINITIONS['auto-restart-on-unresolved-review-threads'].default, true);
  assert.equal(SOLVE_OPTION_DEFINITIONS['check-merge-prerequisites'].default, true);
  assert.deepEqual([normalizeReviewWindowMinutes('30'), normalizeReviewWindowMinutes(-5), normalizeReviewWindowMinutes('x'), normalizeReviewWindowMinutes(2.7)], [30, 0, 0, 2]);
  assert.equal(resolveReviewGateOptions({}).reviewWindowMinutes, 0, 'direct callers keep exiting at once');

  const gate = createReviewGate({ owner: OWNER, repo: REPO, prNumber: PR, commandRunner: async () => response('[]'), options: resolveReviewGateOptions({ autoRestartUntilMergeableReviewWindowMinutes: 60 }) });
  const t0 = Date.parse('2026-11-10T12:00:00Z');
  assert.deepEqual(gate.reviewWindow(t0), { remainingMs: 3_600_000, remainingMinutes: 60 });
  assert.equal(gate.reviewWindow(t0 + 59 * 60_000).remainingMinutes, 1);
  assert.equal(gate.reviewWindow(t0 + 60 * 60_000), null, 'the loop exits once the window is over');
  gate.resetReviewWindow();
  assert.equal(gate.reviewWindow(t0 + 90 * 60_000).remainingMinutes, 60, 'a restart or a new commit opens a new window');
});

test('cases 1 and 5: new threads are fresh once; a failed read holds nothing back', async () => {
  const page = { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [{ id: 'T1', isResolved: false, comments: { totalCount: 1, nodes: [{ author: { login: 'chatgpt-codex-connector[bot]' }, body: '**P1** finding' }] } }] } } } } };
  const gate = createReviewGate({ owner: OWNER, repo: REPO, prNumber: PR, commandRunner: async () => response(page), options: resolveReviewGateOptions({ checkMergePrerequisites: false }) });
  const first = await gate.checkThreads();
  assert.equal(first.fresh.length, 1);
  assert.match(gate.restartFeedback(first.all).join('\n'), /thread id: T1/);
  const second = await gate.checkThreads();
  assert.deepEqual([second.fresh.length, second.alreadyReported.length], [0, 1]);

  const logs = [];
  const broken = createReviewGate({ owner: OWNER, repo: REPO, prNumber: PR, commandRunner: async () => response('', 1), options: resolveReviewGateOptions({}), log: async message => logs.push(message) });
  assert.deepEqual(await broken.checkThreads(), { ok: false, all: [], fresh: [], alreadyReported: [] });
  assert.match(logs.join('\n'), /could not be read/);

  const disabled = createReviewGate({ owner: OWNER, repo: REPO, prNumber: PR, commandRunner: async () => assert.fail('no read when disabled'), options: resolveReviewGateOptions({ autoRestartOnUnresolvedReviewThreads: false }) });
  assert.deepEqual((await disabled.checkThreads()).fresh, []);
});

test('cases 1–3: the watch loop wiring', () => {
  const source = readFileSync(join(root, 'src', 'solve.auto-merge.lib.mjs'), 'utf8');
  const windowStart = source.indexOf('let lastCheckTime = new Date();');
  const cooldown = source.indexOf('await interruptibleSleep(INITIAL_COOLDOWN_SECONDS * 1000);');
  assert.ok(windowStart !== -1 && cooldown !== -1 && windowStart < cooldown, 'comments posted during the initial cooldown are seen (case 1)');
  assert.match(source, /blockers\.length === 0 && !hasNewComments && !hasNewReviewThreads && /, 'a fresh thread is never reported as ready');
  assert.match(source, /feedbackLines\.push\(\.\.\.reviewGate\.restartFeedback\(threadState\.all\)\);/);
  assert.match(source, /const reviewWindow = reviewGate\.reviewWindow\(\);\s+if \(reviewWindow\) \{[\s\S]{0,600}?continue;/, 'the loop keeps watching inside the review window (case 2)');
  assert.match(source, /trustAuthenticatedUserComments: true/, 'same-account comments without tool markers count (case 3)');
});
