#!/usr/bin/env node
/**
 * Issue #4081: AI sessions know about pull request review apps, and the
 * `--auto-restart-until-mergeable` loop waits for them and restarts on their
 * findings.
 *
 * Observed: the session marks the PR ready, `chatgpt-codex-connector[bot]`
 * posts a P2 finding 90 seconds later, and "✅ Ready to merge" follows at
 * T+6 min, because every `[bot]` login was dropped and nothing waited for the
 * review app that had just started.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/4081
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { DEFAULT_REVIEW_BOTS, REVIEW_BOT_ACTIVITY_QUERY, buildReviewBotFindingLines, createReviewBotFindingsTracker, createReviewBotMatcher, evaluateReviewBotActivity, isReviewBotFeedback, normalizeBotLogin, parseCodexReviewState, parseReviewBotsOption, reviewBotSignal } from '../src/review-bots.lib.mjs';
import { getReviewBotsSubPrompt } from '../src/review-bots.prompts.lib.mjs';
import { checkForNonBotComments, reviewsAsFeedbackComments } from '../src/solve.auto-merge-helpers.lib.mjs';
import { createReviewGate, resolveReviewGateOptions } from '../src/solve.auto-merge-review-gate.lib.mjs';

const OWNER = 'link-foundation';
const REPO = 'example';
const PR = 21;
const ISSUE = 20;
const CODEX = 'chatgpt-codex-connector[bot]';
const CODERABBIT = 'coderabbitai[bot]';
const CI_BOTS = ['dependabot[bot]', 'github-actions[bot]', 'codecov[bot]', 'netlify[bot]', 'vercel[bot]', 'renovate[bot]'];

const response = (value, code = 0) => ({ code, stdout: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)), stderr: Buffer.from(code === 0 ? '' : 'HTTP 502') });
const commandText = (strings, values) => strings.reduce((acc, part, index) => acc + part + (index < values.length ? String(values[index]) : ''), '');

const codexSummary = (hasFindings, extra = {}) => `### 💡 Codex Review\n\nHere are some automated review suggestions for this pull request.\n<!-- codex-review-state:v1 ${JSON.stringify({ reviewed_commit: 'abc123', has_unresolved_findings: hasFindings, ...extra })} -->`;
const CODERABBIT_WALKTHROUGH = '<!-- This is an auto-generated comment: summarize by coderabbit.ai -->\n## Walkthrough\nThe change adds a sync step.';
const CODERABBIT_IN_PROGRESS = '<!-- This is an auto-generated comment: review in progress by coderabbit.ai -->\nCurrently processing new changes in this PR.';

test('--review-bots: the default list, additions, replacements and "none"', () => {
  assert.deepEqual(parseReviewBotsOption(undefined), [...DEFAULT_REVIEW_BOTS]);
  assert.deepEqual(parseReviewBotsOption('default'), [...DEFAULT_REVIEW_BOTS]);
  assert.deepEqual(parseReviewBotsOption(true), [...DEFAULT_REVIEW_BOTS]);
  for (const off of ['none', 'off', '', false]) assert.deepEqual(parseReviewBotsOption(off), [], String(off));
  assert.deepEqual(parseReviewBotsOption('my-reviewer[bot], coderabbitai[bot] my-reviewer'), ['my-reviewer[bot]', 'coderabbitai[bot]']);
  const extended = parseReviewBotsOption('default,my-reviewer[bot],chatgpt-codex-connector');
  assert.equal(extended.length, DEFAULT_REVIEW_BOTS.length + 1);
  assert.equal(extended.at(-1), 'my-reviewer[bot]');
  for (const login of ['chatgpt-codex-connector[bot]', 'coderabbitai[bot]', 'copilot-pull-request-reviewer[bot]', 'gemini-code-assist[bot]', 'sourcery-ai[bot]', 'qodo-merge-pro[bot]']) assert.ok(DEFAULT_REVIEW_BOTS.includes(login), login);
});

test('review app matcher: REST and GraphQL logins match; CI and deploy bots do not', () => {
  const isReviewBot = createReviewBotMatcher(DEFAULT_REVIEW_BOTS);
  assert.equal(normalizeBotLogin('CodeRabbitAI[bot]'), 'coderabbitai');
  assert.ok(isReviewBot(CODEX));
  assert.ok(isReviewBot('chatgpt-codex-connector'), 'GraphQL drops the [bot] suffix');
  assert.ok(isReviewBot(CODERABBIT));
  for (const login of [...CI_BOTS, 'github-actions', 'dependabot', 'netlify', 'vercel', 'konard', '', null]) assert.equal(isReviewBot(login), false, String(login));
  assert.equal(createReviewBotMatcher([])(CODEX), false);
});

test('review app signals: the Codex marker, CodeRabbit summaries and in-progress notices', () => {
  assert.deepEqual(parseCodexReviewState(codexSummary(true)), { reviewed_commit: 'abc123', has_unresolved_findings: true });
  assert.equal(parseCodexReviewState('<!-- codex-review-state:v1 {not json} -->'), null);
  assert.equal(parseCodexReviewState('no marker'), null);
  assert.equal(reviewBotSignal(codexSummary(true)), 'findings');
  assert.equal(reviewBotSignal(codexSummary(false)), 'no_findings');
  assert.equal(reviewBotSignal(codexSummary(true, { status: 'running' })), 'in_progress');
  assert.equal(reviewBotSignal('**Actionable comments posted: 3**\n\n<details>...'), 'findings');
  assert.equal(reviewBotSignal('**Actionable comments posted: 0**'), 'no_findings');
  assert.equal(reviewBotSignal(CODERABBIT_IN_PROGRESS), 'in_progress');
  assert.equal(reviewBotSignal(CODERABBIT_WALKTHROUGH), 'unknown');
  assert.equal(reviewBotSignal("Codex Review: Didn't find any major issues. Keep it up!"), 'no_findings');
  assert.equal(isReviewBotFeedback('issue_comment', { body: CODERABBIT_WALKTHROUGH }), false);
  assert.equal(isReviewBotFeedback('issue_comment', { body: codexSummary(true) }), true);
  assert.equal(isReviewBotFeedback('review', { state: 'COMMENTED', body: '**Actionable comments posted: 2**' }), true);
  assert.equal(isReviewBotFeedback('review', { state: 'COMMENTED', body: 'Here are some automated review suggestions for this pull request.' }), false, 'its inline findings are review threads');
  assert.equal(isReviewBotFeedback('review_comment', { body: '**P2** finding' }), false, 'inline findings go through the unresolved-thread gate');
  assert.equal(isReviewBotFeedback('review_comment', { body: '**P2** finding' }, { countInline: true }), true);
  assert.equal(isReviewBotFeedback('review_comment', { body: 'Thanks, looks fixed', in_reply_to_id: 1 }, { countInline: true }), false);
});

test('reviewsAsFeedbackComments: a review app summary review with findings counts, a CI bot review does not', () => {
  const isBot = login => /\[bot\]$/.test(login || '');
  const isReviewBot = createReviewBotMatcher(DEFAULT_REVIEW_BOTS);
  const review = (id, login, state, body) => ({ id, user: { login }, state, body, submitted_at: '2026-11-19T10:00:00Z', html_url: `https://example.test/r/${id}` });
  const entries = reviewsAsFeedbackComments([review(1, CODERABBIT, 'COMMENTED', '**Actionable comments posted: 2**\n<!-- internal state -->'), review(2, CODEX, 'COMMENTED', 'Here are some automated review suggestions.'), review(3, 'codecov[bot]', 'COMMENTED', '**Actionable comments posted: 2**'), review(4, CODERABBIT, 'COMMENTED', '**Actionable comments posted: 0**')], isBot, isReviewBot);
  assert.deepEqual(
    entries.map(entry => entry.id),
    [1]
  );
  assert.equal(entries[0].countsFromBot, true);
  assert.doesNotMatch(entries[0].body, /internal state/, 'HTML comments are not quoted to the AI');
});

const watchGitHub =
  ({ prComments = [], reviewComments = [], reviews = [] }) =>
  async (strings, ...values) => {
    const command = commandText(strings, values);
    if (command === 'gh api user --jq .login') return response('konard\n');
    if (command === `gh api repos/${OWNER}/${REPO}/issues/${PR}/comments --paginate`) return response(prComments);
    if (command === `gh api repos/${OWNER}/${REPO}/pulls/${PR}/comments --paginate`) return response(reviewComments);
    if (command === `gh api repos/${OWNER}/${REPO}/pulls/${PR}/reviews --paginate`) return response(reviews);
    return response('[]');
  };

const lastCheck = new Date('2026-11-19T10:00:00Z');
const at = minutes => new Date(lastCheck.getTime() + minutes * 60_000).toISOString();

test('watch loop: chatgpt-codex-connector[bot] and coderabbitai[bot] findings are feedback', async () => {
  const $ = watchGitHub({
    prComments: [
      { id: 1, user: { login: CODEX }, created_at: at(-1), updated_at: at(2), body: codexSummary(true) },
      { id: 2, user: { login: CODERABBIT }, created_at: at(1), updated_at: at(1), body: CODERABBIT_WALKTHROUGH },
      { id: 3, user: { login: CODERABBIT }, created_at: at(1), updated_at: at(1), body: CODERABBIT_IN_PROGRESS },
    ],
    reviewComments: [{ id: 4, user: { login: CODEX }, created_at: at(2), body: '**P2** Remote-only commits are dropped' }],
    reviews: [{ id: 5, user: { login: CODERABBIT }, state: 'COMMENTED', submitted_at: at(3), body: '**Actionable comments posted: 1**' }],
  });
  const result = await checkForNonBotComments(OWNER, REPO, PR, ISSUE, lastCheck, false, $, { trustAuthenticatedUserComments: true });
  assert.equal(result.hasNewComments, true);
  assert.deepEqual(result.comments.map(comment => comment.id).sort(), [1, 5], 'the Codex summary edited after the last check and the CodeRabbit review; not the walkthrough, the progress notice or the inline finding (a review thread)');
  assert.doesNotMatch(result.comments.find(comment => comment.id === 1).body, /codex-review-state/);

  const withInline = await checkForNonBotComments(OWNER, REPO, PR, ISSUE, lastCheck, false, $, { trustAuthenticatedUserComments: true, countReviewBotInlineComments: true });
  assert.deepEqual(withInline.comments.map(comment => comment.id).sort(), [1, 4, 5], 'with the thread gate off, inline findings count here');

  const disabled = await checkForNonBotComments(OWNER, REPO, PR, ISSUE, lastCheck, false, $, { trustAuthenticatedUserComments: true, reviewBots: [] });
  assert.equal(disabled.hasNewComments, false, '--review-bots none restores the old behavior');
});

test('watch loop: CI and deploy bots stay ignored, whatever their comments say', async () => {
  const body = `${codexSummary(true)}\n**Actionable comments posted: 4**`;
  const $ = watchGitHub({
    prComments: CI_BOTS.map((login, index) => ({ id: 100 + index, user: { login }, created_at: at(5), updated_at: at(5), body })),
    reviewComments: CI_BOTS.map((login, index) => ({ id: 200 + index, user: { login }, created_at: at(5), body: 'Coverage dropped' })),
    reviews: CI_BOTS.map((login, index) => ({ id: 300 + index, user: { login }, state: 'COMMENTED', submitted_at: at(5), body })),
  });
  const result = await checkForNonBotComments(OWNER, REPO, PR, ISSUE, lastCheck, false, $, { trustAuthenticatedUserComments: true, countReviewBotInlineComments: true });
  assert.equal(result.hasNewComments, false);
  assert.deepEqual(result.comments, []);
});

// --- Grace window before "Ready to merge" ---------------------------------

const HEAD = 'head-sha';
const NOW = Date.parse('2026-11-19T12:00:00Z');
const ago = minutes => new Date(NOW - minutes * 60_000).toISOString();
const activityOf = ({ headCommittedAt = ago(5), readyAt = null, comments = [], reviews = [], reactions = [] } = {}) => ({
  headSha: HEAD,
  headCommittedAt,
  timelineEvents: readyAt ? [{ type: 'ReadyForReviewEvent', createdAt: readyAt }] : [],
  comments,
  reviews,
  reactions,
});
const evaluate = (activity, extra = {}) => evaluateReviewBotActivity({ activity, isReviewBot: createReviewBotMatcher(DEFAULT_REVIEW_BOTS), now: NOW, waitMinutes: 15, startGraceMinutes: 3, ...extra });

test('grace window: a review app reacting 👀 on the head commit is waited for, up to the limit', () => {
  const running = evaluate(activityOf({ headCommittedAt: ago(8), readyAt: ago(4), reactions: [{ login: CODEX, content: 'eyes', createdAt: ago(3) }] }));
  assert.equal(running.pending.length, 1);
  assert.equal(running.pending[0].login, CODEX);
  assert.equal(running.remainingMs, 11 * 60_000, 'until 15 minutes after the PR was marked ready');
  assert.equal(running.anchor, Date.parse(ago(4)));

  const tooLong = evaluate(activityOf({ headCommittedAt: ago(20), reactions: [{ login: CODEX, content: 'eyes', createdAt: ago(19) }] }));
  assert.deepEqual(tooLong.pending, []);
  assert.deepEqual(tooLong.timedOut, [CODEX], 'bounded: no endless wait for a stuck review app');

  const done = evaluate(
    activityOf({
      reactions: [
        { login: CODEX, content: 'eyes', createdAt: ago(4) },
        { login: CODEX, content: '+1', createdAt: ago(1) },
      ],
    })
  );
  assert.deepEqual(done.pending, [], '👍 after 👀 means it found nothing');

  const coderabbitRunning = evaluate(activityOf({ comments: [{ id: 9, login: 'coderabbitai', body: CODERABBIT_IN_PROGRESS, createdAt: ago(30), updatedAt: ago(2) }] }));
  assert.equal(coderabbitRunning.pending.length, 1, 'CodeRabbit edits its in-progress comment in place');
});

test('grace window: an app that reviewed earlier commits gets a short start grace; an app never seen is not waited for', () => {
  const earlier = { comments: [{ id: 1, login: 'chatgpt-codex-connector', body: codexSummary(false), createdAt: ago(60), updatedAt: ago(60) }] };
  const justPushed = evaluate(activityOf({ headCommittedAt: ago(1), ...earlier }));
  assert.equal(justPushed.pending.length, 1);
  assert.equal(justPushed.remainingMs, 2 * 60_000);
  assert.deepEqual(evaluate(activityOf({ headCommittedAt: ago(4), ...earlier })).pending, [], 'it may not re-review every push');
  assert.deepEqual(evaluate(activityOf({ headCommittedAt: ago(1) })).pending, [], 'no review app on this pull request');
  assert.deepEqual(evaluate(activityOf({ headCommittedAt: ago(1), ...earlier }), { waitMinutes: 0, startGraceMinutes: 0 }).pending, [], '--review-bots-wait-minutes 0');
  const ciOnly = evaluate(activityOf({ headCommittedAt: ago(1), reactions: [{ login: 'github-actions[bot]', content: 'eyes', createdAt: ago(0.5) }], comments: [{ id: 2, login: 'codecov', body: codexSummary(true), createdAt: ago(0.5) }] }));
  assert.deepEqual(ciOnly.pending, []);
  assert.deepEqual(ciOnly.findings, []);
});

test('grace window: findings come from summaries about the head commit only', () => {
  const state = evaluate(
    activityOf({
      headCommittedAt: ago(10),
      comments: [
        { id: 1, url: 'https://example.test/c/1', login: 'chatgpt-codex-connector', body: codexSummary(true), createdAt: ago(8), updatedAt: ago(8) },
        { id: 2, url: 'https://example.test/c/2', login: 'chatgpt-codex-connector', body: codexSummary(true), createdAt: ago(90), updatedAt: ago(90) },
      ],
      reviews: [{ id: 3, login: 'coderabbitai', state: 'COMMENTED', body: '**Actionable comments posted: 1**', submittedAt: ago(30), commitOid: HEAD }],
    })
  );
  assert.deepEqual(
    state.findings.map(finding => finding.id),
    [`1@${ago(8)}`],
    'the summary about an older commit is stale'
  );
  assert.equal(state.findings[0].login, 'chatgpt-codex-connector');
  assert.doesNotMatch(state.findings[0].excerpt, /codex-review-state/);
  assert.deepEqual(state.pending, [], 'a finished review of the head commit is not waited for');
  assert.deepEqual(evaluate(null).pending, []);
});

test('findings tracker and restart feedback name each review app summary once', () => {
  const tracker = createReviewBotFindingsTracker();
  const findings = [{ id: '1@t', login: CODEX, url: 'https://example.test/c/1', excerpt: 'Codex Review' }];
  assert.equal(tracker.split(findings).fresh.length, 1);
  tracker.markReported(findings);
  assert.deepEqual(tracker.split(findings), { fresh: [], alreadyReported: findings });
  const lines = buildReviewBotFindingLines(findings);
  assert.match(lines[0], /Review apps report unresolved findings/);
  assert.match(lines[1], /chatgpt-codex-connector\[bot\].*https:\/\/example\.test\/c\/1/);
  assert.match(lines.at(-1), /address every finding/);
});

// --- Review gate -----------------------------------------------------------

const gateGitHub =
  ({ activity, reactions = [], fail = false }) =>
  async (strings, ...values) => {
    const command = commandText(strings, values);
    if (command.startsWith('gh api graphql') && command.includes('timelineItems')) {
      if (fail) return response('', 1);
      return response({ data: { repository: { pullRequest: activity } } });
    }
    if (command === `gh api repos/${OWNER}/${REPO}/issues/${PR}/reactions --paginate`) return response(reactions);
    return response('[]');
  };

const graphqlActivity = ({ comments = [], reviews = [], committedDate }) => ({
  headRefOid: HEAD,
  isDraft: false,
  commits: { nodes: [{ commit: { oid: HEAD, committedDate } }] },
  timelineItems: { nodes: [] },
  comments: { nodes: comments },
  reviews: { nodes: reviews },
});

test('review gate: waits for a running review app, restarts on its findings, then holds "Ready to merge" naming them', async () => {
  const options = resolveReviewGateOptions({ reviewBotsWaitMinutes: 15, checkMergePrerequisites: false, autoRestartOnUnresolvedReviewThreads: false });
  assert.deepEqual(options.reviewBots, [...DEFAULT_REVIEW_BOTS]);
  assert.equal(options.reviewBotsWaitMinutes, 15);
  const now = Date.now();
  const iso = minutes => new Date(now - minutes * 60_000).toISOString();

  const running = createReviewGate({ owner: OWNER, repo: REPO, prNumber: PR, commandRunner: gateGitHub({ activity: graphqlActivity({ committedDate: iso(2) }), reactions: [{ user: { login: CODEX }, content: 'eyes', created_at: iso(1) }] }), options });
  const waiting = await running.checkReviewBots(now);
  assert.equal(waiting.ok, true);
  assert.equal(waiting.pending[0].login, CODEX);
  assert.ok(waiting.remainingMs > 12 * 60_000 && waiting.remainingMs <= 13 * 60_000);

  const summary = { databaseId: 41, url: 'https://example.test/c/41', author: { login: 'chatgpt-codex-connector' }, body: codexSummary(true), createdAt: iso(1), updatedAt: iso(1) };
  const gate = createReviewGate({ owner: OWNER, repo: REPO, prNumber: PR, commandRunner: gateGitHub({ activity: graphqlActivity({ committedDate: iso(5), comments: [summary] }) }), options });
  const first = await gate.checkReviewBots(now);
  assert.deepEqual(first.pending, []);
  assert.equal(first.fresh.length, 1, 'restart: the AI has not seen these findings');
  assert.deepEqual(gate.restartReviewBotFeedback(first.findings, [41]), [], 'already quoted as a new comment');
  const second = await gate.checkReviewBots(now);
  assert.equal(second.fresh.length, 0);
  assert.equal(second.alreadyReported.length, 1);
  const holds = await gate.collectHolds({ alreadyReported: [] }, second);
  assert.equal(holds.length, 1);
  assert.equal(holds[0].reason, 'review_bot_findings');
  assert.match(holds[0].items[0], /chatgpt-codex-connector.*https:\/\/example\.test\/c\/41/);
  assert.match(gate.holdsAsMergeBlockers(holds)[0].message, /unresolved findings/);
});

test('review gate: bounded wait, restart reasons and the start-up description', () => {
  const gate = createReviewGate({ owner: OWNER, repo: REPO, prNumber: PR, commandRunner: async () => response('[]'), options: resolveReviewGateOptions({ reviewBotsWaitMinutes: 15 }) });
  assert.equal(gate.reviewBotsWait({ pending: [] }, 300, 120), null);
  const pending = { pending: [{ login: CODEX, reason: 'reviewing (👀)' }], remainingMs: 7 * 60_000 };
  assert.deepEqual(gate.reviewBotsWait(pending, 300, 120), { seconds: 300, detail: `${CODEX} (reviewing (👀)); up to 7 more minute(s)` });
  assert.equal(gate.reviewBotsWait({ ...pending, remainingMs: 30_000 }, 300, 120).seconds, 120, 'never polls faster than the loop minimum');
  assert.equal(gate.reviewBotsWait({ ...pending, remainingMs: 200_000 }, 300, 120).seconds, 200, 'never sleeps past the deadline');
  assert.deepEqual(gate.restartReasons({ fresh: [{ author: CODEX }, { author: CODEX }] }, { fresh: [{ login: CODERABBIT }] }), [`2 unresolved review thread(s) from ${CODEX}`, `review bot finding(s) from ${CODERABBIT}`]);
  assert.deepEqual(gate.restartReasons({ fresh: [] }, null), []);
  assert.match(gate.describeReviewBots(), /^chatgpt-codex-connector\[bot\], coderabbitai\[bot\].*wait up to 15 minute/);
  assert.equal(createReviewGate({ options: resolveReviewGateOptions({ reviewBots: 'none' }) }).describeReviewBots(), 'none (--review-bots none)');
});

test('review gate: unreadable activity fails open, and --review-bots none reads nothing', async () => {
  const logs = [];
  const broken = createReviewGate({ owner: OWNER, repo: REPO, prNumber: PR, commandRunner: gateGitHub({ fail: true }), options: resolveReviewGateOptions({ reviewBotsWaitMinutes: 15 }), log: async message => logs.push(message) });
  const state = await broken.checkReviewBots();
  assert.equal(state.ok, false);
  assert.deepEqual(state.pending, []);
  assert.match(logs.join('\n'), /not waiting for them/);
  const off = createReviewGate({ owner: OWNER, repo: REPO, prNumber: PR, commandRunner: async () => assert.fail('no read with --review-bots none'), options: resolveReviewGateOptions({ reviewBots: 'none' }) });
  assert.deepEqual((await off.checkReviewBots()).pending, []);
  assert.equal(resolveReviewGateOptions({}).reviewBotsWaitMinutes, 0, 'direct callers do not wait unless asked');
  assert.match(REVIEW_BOT_ACTIVITY_QUERY, /READY_FOR_REVIEW_EVENT/);
});

test('watch loop wiring: review app findings block "Ready to merge", and pending review apps are waited for first', async () => {
  const source = await readFile(new URL('../src/solve.auto-merge.lib.mjs', import.meta.url), 'utf8');
  assert.match(source, /!hasNewReviewThreads && !hasNewReviewBotFindings &&/);
  const waitIndex = source.indexOf("'Waiting for review bots:'");
  assert.ok(waitIndex > 0 && waitIndex < source.indexOf("'PR IS MERGEABLE!'"), 'the wait comes before "Ready to merge" and auto-merge');
  assert.match(source, /reviewGate\.collectHolds\(threadState, botState\)/);
  assert.match(source, /reviewBots: reviewGate\.options\.reviewBots/);
  assert.match(source, /reviewGate\.restartReasons\(threadState, botState\)/);
  assert.match(source, /reviewGate\.restartReviewBotFeedback\(botState\.findings/);
});

// --- Prompt (proposal A) ---------------------------------------------------

const tools = ['agent', 'claude', 'codex', 'gemini', 'opencode', 'qwen'];
const params = { issueUrl: `https://github.com/${OWNER}/${REPO}/issues/${ISSUE}`, issueNumber: ISSUE, prNumber: PR, prUrl: `https://github.com/${OWNER}/${REPO}/pull/${PR}`, branchName: 'issue-20', tempDir: '/tmp/work', workspaceTmpDir: '/tmp/work-tmp', owner: OWNER, repo: REPO, argv: {} };

test('prompt: the review-app instruction names the apps, the signals and a bounded wait', () => {
  const text = getReviewBotsSubPrompt(params);
  assert.match(text, /^\n {3}- When you mark the pull request ready or push to it/, 'one more issue-completion bullet');
  assert.match(text, /review apps such as chatgpt-codex-connector\[bot\], coderabbitai\[bot\]/);
  assert.match(text, /wait up to 15 minutes/);
  assert.match(text, /👀 means reviewing/);
  assert.match(text, /"has_unresolved_findings":false means no findings/);
  assert.match(text, /address every finding: fix it and resolve the thread, or reply with evidence/);
  assert.ok(Buffer.byteLength(text) < 340, 'compact: the issue #3837 prompt budget has little headroom');
  assert.match(getReviewBotsSubPrompt({ ...params, argv: { reviewBotsWaitMinutes: 5 } }), /wait up to 5 minutes/);
  assert.match(getReviewBotsSubPrompt({ ...params, argv: { reviewBots: 'my-reviewer[bot]' } }), /such as my-reviewer\[bot\] \(/);
  assert.equal(getReviewBotsSubPrompt({ ...params, argv: { reviewBots: 'none' } }), '');
});

for (const tool of tools) {
  test(`prompt: the ${tool} system prompt tells the AI about review apps`, async () => {
    const prompts = await import(`../src/${tool}.prompts.lib.mjs`);
    const system = prompts.buildSystemPrompt(params);
    assert.ok(system.includes(getReviewBotsSubPrompt(params).trim()), tool);
    assert.doesNotMatch(prompts.buildSystemPrompt({ ...params, argv: { reviewBots: 'none' } }), /review apps such as/, `${tool} with --review-bots none`);
  });
}
