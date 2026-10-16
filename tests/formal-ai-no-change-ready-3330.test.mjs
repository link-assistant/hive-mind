#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Issue #3330: every Formal AI draft that changed nothing was marked "ready for
 * review (solution draft verified)".
 *
 * Replay of run 38728898890 (PR #3327 of link-assistant/hive-mind):
 *   - solve ran under the workflow's GITHUB_TOKEN, an installation token, so
 *     `gh api user` answered 403 "Resource not accessible by integration";
 *   - the comment check therefore could not tell who "the AI" was, the verdict
 *     was "unmeasured", and an unmeasured verdict fell through to
 *     `ensurePullRequestIsReady`;
 *   - that gate counts the pull request diff, which held the solver's
 *     `dev/log/**` commit, so the diff "had changes" and the draft was readied;
 *   - Formal AI itself had ended with `terminal_state "planned_not_executed"`.
 *
 * What this test pins down:
 *   - a non-executed Formal AI terminal state decides "finished without
 *     changes" on its own, without reading comments: the PR stays a draft, the
 *     notice is posted, solve exits 5;
 *   - an unmeasured verdict never readies a pull request: its state is kept and
 *     the reason ("could not verify the session's effect") is published;
 *   - when `/user` is forbidden, the token's identity comes from GraphQL
 *     `viewer`, then from the Actions environment (`github-actions[bot]`);
 *   - the readiness gate does not count `dev/log/**` or AI tool scratch, with
 *     the same predicate the session verdict uses;
 *   - a real code commit still readies the pull request.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3330
 */

import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, test } from 'node:test';

import { isAiToolScratchFile, isSolverBookkeepingFile } from '../src/ai-tool-scratch.lib.mjs';
import { ensurePullRequestIsDraft, ensurePullRequestIsReady, getPullRequestLeftInDraft, markPullRequestCreatedByThisRun, resetWorkingSessionDrafts, restoreDeliberateDraftsAtRunEnd } from '../src/pr-draft-state.lib.mjs';
import { __measureDiffForTests as measureDiff } from '../src/pull-request-changes.lib.mjs';
import { resetRepeatedToolCallState } from '../src/repeated-tool-call-breaker.lib.mjs';
import { captureSessionChangeBaseline, EXIT_CODE_SOLVE_NO_CHANGES, evaluateSessionChanges, isFormalAiNonExecutedState, isSolverCommit, reevaluateRunWithoutChanges, reportSessionWithoutChanges, resetSessionChanges, SESSION_EFFECT_UNVERIFIED_DRAFT_KIND } from '../src/session-changes.lib.mjs';
import { checkForAiCreatedComments } from '../src/solve.session-comments.lib.mjs';
import { FINISHED_WITHOUT_CHANGES_MARKER, SESSION_EFFECT_UNVERIFIED_MARKER, TOOL_GENERATED_COMMENT_MARKERS } from '../src/tool-comments.lib.mjs';

const OWNER = 'link-assistant';
const REPO = 'hive-mind';
const ISSUE = 3326;
const PR = 3327;
const FORBIDDEN = { code: 1, stdout: '', stderr: 'gh: Resource not accessible by integration (HTTP 403)' };

const diffSection = (path, lines) => [`diff --git a/${path} b/${path}`, 'new file mode 100644', '--- /dev/null', `+++ b/${path}`, `@@ -0,0 +1,${lines.length} @@`, ...lines.map(line => `+${line}`)].join('\n');

/** The pull request diff of the run: the placeholder and the development log. */
const DEV_LOG_DIFF = [diffSection('.gitkeep', ['# .gitkeep file auto-generated at 2026-10-15T11:40:02.000Z for PR creation at branch issue-3326-eed8a6871a36 for issue https://github.com/link-assistant/hive-mind/issues/3326']), diffSection(`dev/log/issues/${ISSUE}/pulls/${PR}/session.md`, ['# Session', 'terminal_state "planned_not_executed"']), diffSection('.formal-ai/plan.lino', ['plan'])].join('\n');
const CODE_DIFF = `${DEV_LOG_DIFF}\n${diffSection('src/fix.mjs', ['export const fixed = true;'])}`;

/**
 * A command-stream style `$` over a fake repository and a fake GitHub that
 * answers like an installation token: `/user` is forbidden.
 */
const makeFakeShell = state => {
  const commands = [];
  const posted = [];
  const respond = (command, options) => {
    const ok = stdout => ({ code: 0, stdout, stderr: '' });
    if (command === 'git rev-parse HEAD') return ok(`${state.commits.at(-1).sha}\n`);
    if (command.startsWith('git rev-parse --verify -q @{u}')) return ok(`${state.commits[state.upstream].sha}\n`);
    if (command.startsWith('git status --porcelain')) return ok(state.status || '');
    if (command.startsWith('git log')) {
      const [from, to] = command.split(' ').at(-1).split('..');
      const fromIndex = state.commits.findIndex(commit => commit.sha === from);
      const toIndex = state.commits.findIndex(commit => commit.sha === to);
      return ok(
        state.commits
          .slice(fromIndex + 1, toIndex + 1)
          .reverse()
          .map(commit => `\u001e${commit.subject}\n\n${commit.files.join('\n')}\n`)
          .join('')
      );
    }
    if (command === 'gh api user --jq .login') return FORBIDDEN;
    if (command.startsWith('gh api graphql')) return state.viewer ? ok(`${state.viewer}\n`) : FORBIDDEN;
    if (command.startsWith('gh api') && command.includes('-X POST')) {
      posted.push(JSON.parse(options.stdin).body);
      return ok(JSON.stringify({ id: 9000 + posted.length }));
    }
    if (command.startsWith('gh api') && command.includes('/reviews')) return ok('[]');
    if (command.startsWith('gh api') && command.includes('/comments')) return ok(JSON.stringify(command.includes('/pulls/') ? [] : state.comments || []));
    if (command.startsWith('gh pr diff')) return ok(state.diff);
    if (command.startsWith('gh pr view')) return ok(JSON.stringify({ isDraft: state.isDraft, state: 'OPEN' }));
    if (command.startsWith('gh pr ready')) {
      state.isDraft = command.includes('--undo');
      return ok('');
    }
    return ok('');
  };
  const tag =
    (options = {}) =>
    (strings, ...values) => {
      const command = strings.reduce((acc, part, index) => acc + part + (index < values.length ? String(values[index]) : ''), '').trim();
      commands.push(command);
      return Promise.resolve(respond(command, options));
    };
  const $ = (first, ...rest) => (Array.isArray(first) && first.raw ? tag()(first, ...rest) : tag(first || {}));
  $.commands = commands;
  $.posted = posted;
  return $;
};

const logs = [];
const log = async message => {
  logs.push(String(message));
};

const draftRepo = () => ({
  commits: [
    { sha: 'base000', subject: 'Merge pull request #3325', files: ['src/solve.mjs'] },
    { sha: 'init001', subject: 'Initial commit with task details', files: ['.gitkeep'] },
  ],
  upstream: 1,
  isDraft: true,
  diff: DEV_LOG_DIFF,
  viewer: null,
});

let tempDir = null;
const savedEnv = { GITHUB_ACTIONS: process.env.GITHUB_ACTIONS };

beforeEach(() => {
  resetSessionChanges();
  resetWorkingSessionDrafts();
  resetRepeatedToolCallState();
  logs.length = 0;
  // The identity fallback reads the Actions environment; CI itself sets it.
  delete process.env.GITHUB_ACTIONS;
});

after(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  if (savedEnv.GITHUB_ACTIONS === undefined) delete process.env.GITHUB_ACTIONS;
  else process.env.GITHUB_ACTIONS = savedEnv.GITHUB_ACTIONS;
});

/** Start a run the way solve.mjs does: the PR this run created, a baseline, then the session's log. */
const startRun = async (state, { model = 'formal-ai', logText = '' } = {}) => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = mkdtempSync(join(tmpdir(), 'formal-ai-no-change-3330-'));
  const logFile = join(tempDir, 'solve.log');
  writeFileSync(logFile, '');
  const $ = makeFakeShell(state);
  markPullRequestCreatedByThisRun({ owner: OWNER, repo: REPO, prNumber: PR });
  await ensurePullRequestIsDraft({ owner: OWNER, repo: REPO, prNumber: PR, $, log });
  await captureSessionChangeBaseline({ tempDir, $, log, logFile, owner: OWNER, repo: REPO, issueNumber: ISSUE, prNumber: PR, model, now: new Date(Date.now() - 60_000) });
  if (logText) appendFileSync(logFile, logText);
  return $;
};

/** verifyResults() (solve.results.lib.mjs), reduced to the readiness decision. */
const verifyReadiness = async $ => {
  const outcome = await reportSessionWithoutChanges({ owner: OWNER, repo: REPO, prNumber: PR, issueNumber: ISSUE, $, log });
  let ready = null;
  if (!outcome.keepsDraft) ready = await ensurePullRequestIsReady({ owner: OWNER, repo: REPO, prNumber: PR, $, log, reason: 'solution draft verified', requireChanges: true });
  const restored = await restoreDeliberateDraftsAtRunEnd({ $, log });
  return { outcome, ready, restored };
};

const PLANNED_NOT_EXECUTED_LOG = '{"type":"result","result":"Plan event:\\n\\n```text\\ngeneral_change_plan\\n  terminal_state \\"planned_not_executed\\"\\n```"}\n';
const devLogCommit = state => state.commits.push({ sha: 'devlog1', subject: `Add development log for issue #${ISSUE} PR #${PR}`, files: [`dev/log/issues/${ISSUE}/pulls/${PR}/session.md`] });
/** GitHub reads of the comment check (posting the notice is not one). */
const commentReads = $ => $.commands.filter(command => /^gh api (user|graphql|repos\/.*\/(comments|reviews))/.test(command) && !command.includes('-X POST'));

test('replay of run 38728898890: 403 on /user, a dev-log commit, planned_not_executed - the draft stays a draft and solve exits 5', async () => {
  const state = draftRepo();
  const $ = await startRun(state, { logText: PLANNED_NOT_EXECUTED_LOG });
  devLogCommit(state);
  state.upstream = state.commits.length - 1;

  const { outcome, ready } = await verifyReadiness($);
  assert.equal(outcome.noChanges, true, 'Formal AI did not execute its plan: finished without changes');
  assert.equal(outcome.keepsDraft, true);
  assert.equal(outcome.exitCode, EXIT_CODE_SOLVE_NO_CHANGES);
  assert.equal(EXIT_CODE_SOLVE_NO_CHANGES, 5);
  assert.equal(ready, null, 'the readiness gate is not reached');
  assert.equal(state.isDraft, true, 'the pull request is not marked ready for review');
  assert.equal($.commands.filter(command => command.startsWith('gh pr ready') && !command.includes('--undo')).length, 0);
  assert.deepEqual(commentReads($), [], 'the terminal state decides on its own; comments are not read');
  assert.equal($.posted.length, 1);
  assert.match($.posted[0], new RegExp(FINISHED_WITHOUT_CHANGES_MARKER));
  assert.match($.posted[0], /planned_not_executed/);
  assert.ok(!logs.some(line => line.includes('solution draft verified')));
  assert.equal((await reevaluateRunWithoutChanges({ log }))?.noChanges, true, 'still exit 5 at run end');
});

test('a real code commit still marks the pull request ready, even with /user forbidden', async () => {
  const state = { ...draftRepo(), diff: CODE_DIFF };
  const $ = await startRun(state, { logText: '{"type":"result","result":"terminal_state \\"executed\\""}\n' });
  state.commits.push({ sha: 'work001', subject: 'Fix the readiness gate', files: ['src/fix.mjs'] });
  devLogCommit(state);
  state.upstream = state.commits.length - 1;

  const { outcome, ready } = await verifyReadiness($);
  assert.equal(outcome.noChanges, false);
  assert.equal(outcome.keepsDraft, false);
  assert.equal(outcome.exitCode, 0);
  assert.equal(ready?.reason !== 'no_changes', true);
  assert.equal(state.isDraft, false, 'real work is ready for review');
  assert.equal($.posted.length, 0);
});

test('a planned_not_executed state does not override a real commit', async () => {
  const state = { ...draftRepo(), diff: CODE_DIFF };
  const $ = await startRun(state, { logText: PLANNED_NOT_EXECUTED_LOG });
  state.commits.push({ sha: 'work001', subject: 'Fix the readiness gate', files: ['src/fix.mjs'] });
  const outcome = await evaluateSessionChanges({ $, owner: OWNER, repo: REPO, prNumber: PR, issueNumber: ISSUE, log });
  assert.equal(outcome.evidence, 'commit');
  assert.equal(outcome.noChanges, false);
});

test('an unmeasured verdict keeps the draft and says why, it never marks the PR ready', async () => {
  // A Claude session: no terminal state, and no token identity anywhere.
  const state = draftRepo();
  const $ = await startRun(state, { model: 'opus' });
  devLogCommit(state);

  const { outcome, ready, restored } = await verifyReadiness($);
  assert.equal(outcome.noChanges, false, 'not reported as finished without changes');
  assert.equal(outcome.unmeasured, true);
  assert.equal(outcome.keepsDraft, true);
  assert.equal(outcome.exitCode, 0);
  assert.equal(ready, null);
  assert.equal(state.isDraft, true, 'not ready: the session effect was not verified');
  assert.equal(getPullRequestLeftInDraft({ owner: OWNER, repo: REPO, prNumber: PR })?.kind, SESSION_EFFECT_UNVERIFIED_DRAFT_KIND);
  assert.equal(restored[0]?.reason, SESSION_EFFECT_UNVERIFIED_DRAFT_KIND, 'the run-end restore does not ready it either');
  assert.equal($.posted.length, 1);
  assert.match($.posted[0], new RegExp(SESSION_EFFECT_UNVERIFIED_MARKER));
  assert.match($.posted[0], /could not verify the session's effect/i);
  assert.ok(TOOL_GENERATED_COMMENT_MARKERS.includes(SESSION_EFFECT_UNVERIFIED_MARKER), 'the notice is not mistaken for an AI comment');
  assert.ok(logs.some(line => /could not verify the session's effect/i.test(line)));
});

test('an unmeasured verdict leaves a pull request that was ready before the run ready', async () => {
  const state = { ...draftRepo(), isDraft: false };
  const $ = makeFakeShell(state);
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = mkdtempSync(join(tmpdir(), 'formal-ai-no-change-3330-'));
  await ensurePullRequestIsDraft({ owner: OWNER, repo: REPO, prNumber: PR, $, log });
  await captureSessionChangeBaseline({ tempDir, $, log, owner: OWNER, repo: REPO, issueNumber: ISSUE, prNumber: PR, model: 'opus', now: new Date(Date.now() - 60_000) });
  const { outcome } = await verifyReadiness($);
  assert.equal(outcome.unmeasured, true);
  assert.equal(outcome.keepsDraft, true, 'the readiness gate is skipped');
  assert.equal(state.isDraft, false, 'its pre-run state (ready) is restored, not changed');
});

test('when /user is forbidden the token identity comes from GraphQL viewer, then from GITHUB_ACTIONS', async () => {
  const since = new Date(Date.now() - 60_000);
  const comment = { id: 1, user: { login: 'github-actions[bot]' }, created_at: new Date().toISOString(), body: 'The requested change is already in place.' };
  const check = $ => checkForAiCreatedComments({ sessionStartTime: since, owner: OWNER, repo: REPO, prNumber: PR, issueNumber: ISSUE, $, log, unknownAs: null });

  assert.equal(await check(makeFakeShell({ ...draftRepo(), comments: [comment] })), null, 'no identity: unknown, not "no comment"');
  assert.equal(await check(makeFakeShell({ ...draftRepo(), comments: [comment], viewer: 'github-actions[bot]' })), true);
  assert.equal(await check(makeFakeShell({ ...draftRepo(), comments: [comment], viewer: 'github-actions' })), true, 'a viewer login without the [bot] suffix matches the REST login');
  assert.equal(await check(makeFakeShell({ ...draftRepo(), comments: [{ ...comment, user: { login: 'my-app[bot]' } }], viewer: 'my-app[bot]' })), true, 'an app token is <app-slug>[bot]');
  assert.equal(await check(makeFakeShell({ ...draftRepo(), comments: [{ ...comment, user: { login: 'someone-else' } }], viewer: 'github-actions[bot]' })), false);

  process.env.GITHUB_ACTIONS = 'true';
  assert.equal(await check(makeFakeShell({ ...draftRepo(), comments: [comment] })), true, 'GITHUB_TOKEN in Actions is github-actions[bot]');
  assert.equal(await check(makeFakeShell({ ...draftRepo(), comments: [] })), false, 'an identity is known, so "no comment" is measured');
});

test('the readiness gate does not count the development log or AI tool scratch', () => {
  const placeholderAndLog = measureDiff(DEV_LOG_DIFF);
  assert.equal(placeholderAndLog.filesChanged, 0, 'the run 38728898890 diff is not a change');
  assert.deepEqual(placeholderAndLog.files, []);
  assert.equal(placeholderAndLog.bookkeepingSections, 2);

  const withCode = measureDiff(CODE_DIFF);
  assert.equal(withCode.filesChanged, 1);
  assert.deepEqual(withCode.files, ['src/fix.mjs']);
  assert.equal(withCode.additions, 1);

  // A tracked file under `data/cache/derivations/` is the user's work (#2119).
  assert.equal(measureDiff(diffSection('data/cache/derivations/answer_1.lino', ['x'])).filesChanged, 1);
});

test('the session verdict and the readiness gate share one bookkeeping predicate', () => {
  for (const path of [`dev/log/issues/${ISSUE}/pulls/${PR}/session.md`, '.formal-ai/plan.lino', '.playwright-mcp/trace.json']) {
    assert.equal(isSolverBookkeepingFile(path), true, path);
    assert.equal(isSolverCommit({ subject: 'Update notes', files: [path] }), true, path);
  }
  for (const path of ['src/fix.mjs', 'docs/dev/log/notes.md', 'data/cache/derivations/answer_1.lino']) {
    assert.equal(isSolverBookkeepingFile(path), false, path);
    assert.equal(isSolverCommit({ subject: 'Update notes', files: [path] }), false, path);
  }
  assert.equal(isAiToolScratchFile('data/cache/derivations/answer_1.lino'), true, 'untracked derivations remain scratch in the working tree');
});

test('Formal AI terminal states: only an executed one needs further evidence', () => {
  assert.equal(isFormalAiNonExecutedState('planned_not_executed'), true);
  assert.equal(isFormalAiNonExecutedState('blocked'), true);
  assert.equal(isFormalAiNonExecutedState('executed'), false);
  assert.equal(isFormalAiNonExecutedState(null), false);
});
