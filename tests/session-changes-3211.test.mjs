#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #3211: a working session that changed nothing
 * was reported as a success.
 *
 * `/claude … --model formal-ai` (2026-10-13): two turns - one `WebFetch`, then a
 * final text that only restated the tool output. No commit, no file change, no
 * comment. The pull request already had 7 commits from earlier sessions, so the
 * #2247 empty-diff guard (which measures the whole pull request) passed, the PR
 * was converted to ready for review and the log said
 * `🎉 SUCCESS: A solution draft has been prepared as a pull request`.
 *
 * What this test pins down:
 *   - progress is measured for THIS run: branch head, upstream and working tree
 *     at session start against the end, plus comments the AI posted;
 *   - solver bookkeeping commits ("Initial commit with task details", its revert,
 *     the development log) are not progress;
 *   - the legitimate no-diff outcomes still count: pushing earlier work, a
 *     comment-only answer, an uncommitted edit;
 *   - a git error is "unmeasured", never "no change";
 *   - a Formal AI draft that ends `planned_not_executed` names that state as the
 *     reason;
 *   - the outcome is published (PR comment, exit code 5, Telegram ⚠️) and the
 *     pull request is not converted to ready.
 *
 * git and gh are stubbed: the test is finite and touches no network.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3211
 * @see https://github.com/link-assistant/hive-mind/issues/3248
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildFinishedWithoutChangesComment, captureSessionChangeBaseline, evaluateSessionChanges, EXIT_CODE_SOLVE_NO_CHANGES, extractFormalAiTerminalState, isSolverCommit, NO_SESSION_CHANGES_DRAFT_KIND, reevaluateRunWithoutChanges, reportSessionWithoutChanges, resetSessionChanges } from '../src/session-changes.lib.mjs';
import { ensurePullRequestIsDraft, ensurePullRequestIsReady, getPullRequestLeftInDraft, markPullRequestCreatedByThisRun, resetWorkingSessionDrafts, restoreDeliberateDraftsAtRunEnd } from '../src/pr-draft-state.lib.mjs';
import { createRepeatedToolCallBreaker, resetRepeatedToolCallState } from '../src/repeated-tool-call-breaker.lib.mjs';
import { buildDeliberateDraftFeedback } from '../src/solve.auto-merge-guards.lib.mjs';
import { FINISHED_WITHOUT_CHANGES_MARKER, TOOL_GENERATED_COMMENT_MARKERS } from '../src/tool-comments.lib.mjs';
import { formatSessionCompletionMessage } from '../src/work-session-formatting.lib.mjs';
import { initI18n } from '../src/i18n.lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readSrc = name => readFileSync(join(__dirname, '..', 'src', name), 'utf8');

const OWNER = 'konard';
const REPO = 'test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a';

/**
 * A fake repository behind a command-stream style `$`.
 *
 * `state.commits` is the branch history, oldest first; `state.upstream` the
 * index of the commit `@{u}` points at. `gh api` answers from `state.comments`.
 */
const makeFakeShell = state => {
  const commands = [];
  const posted = [];
  const respond = (command, options) => {
    const ok = stdout => ({ code: 0, stdout, stderr: '' });
    if (state.gitBroken && command.startsWith('git ')) return { code: 128, stdout: '', stderr: 'fatal: not a git repository' };
    if (command === 'git rev-parse HEAD') return ok(`${state.commits.at(-1).sha}\n`);
    if (command.startsWith('git rev-parse --verify -q @{u}')) return state.upstream === null ? { code: 1, stdout: '', stderr: '' } : ok(`${state.commits[state.upstream].sha}\n`);
    if (command.startsWith('git status --porcelain')) return ok(state.status);
    if (command.startsWith('git log')) {
      const [from, to] = command.split(' ').at(-1).split('..');
      const toIndex = state.commits.findIndex(commit => commit.sha === to);
      const fromIndex = state.commits.findIndex(commit => commit.sha === from);
      const range = state.commits.slice(fromIndex + 1, toIndex + 1).reverse();
      return ok(range.map(commit => `\u001e${commit.subject}\n\n${commit.files.join('\n')}\n`).join(''));
    }
    if (command === 'gh api user --jq .login') return ok('konard\n');
    if (command.startsWith('gh api') && command.includes('-X POST')) {
      posted.push(JSON.parse(options.stdin).body);
      return ok(JSON.stringify({ id: 9000 + posted.length }));
    }
    if (command.startsWith('gh api') && command.includes('/comments')) return ok(JSON.stringify(command.includes('/pulls/') ? [] : state.comments));
    if (command.startsWith('gh pr view')) return ok(JSON.stringify({ isDraft: state.isDraft, state: state.prState || 'OPEN' }));
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

/** PR #2 of the reproduction: 7 commits from earlier sessions, a human draft. */
const reproductionRepo = () => ({
  commits: [{ sha: 'base000', subject: 'Initial commit', files: ['README.md'] }, ...Array.from({ length: 6 }, (_, index) => ({ sha: `old${index}`, subject: `Earlier session work ${index}`, files: ['Main.kt'] })), { sha: 'init001', subject: 'Initial commit with task details', files: ['.gitkeep'] }],
  upstream: 7,
  status: '',
  comments: [],
  isDraft: true,
});

const commit = (state, sha, subject, files) => state.commits.push({ sha, subject, files });

let tempDir = null;
let logFile = null;
const freshRun = async (state, { logText = '' } = {}) => {
  resetSessionChanges();
  resetWorkingSessionDrafts();
  resetRepeatedToolCallState();
  logs.length = 0;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = mkdtempSync(join(tmpdir(), 'session-changes-3211-'));
  logFile = join(tempDir, 'solve.log');
  writeFileSync(logFile, '[2026-10-13] earlier run output: terminal_state "planned_not_executed"\n');
  const $ = makeFakeShell(state);
  const baseline = await captureSessionChangeBaseline({ tempDir, $, log, logFile, owner: OWNER, repo: REPO, issueNumber: 1, prNumber: 2, now: new Date(Date.now() - 60_000) });
  if (logText) appendFileSync(logFile, logText);
  return { $, baseline };
};

// --- The exit code is reserved and documented ----------------------------

assert.equal(EXIT_CODE_SOLVE_NO_CHANGES, 5, 'exit code 5 means "finished without changes"');
assert.equal(NO_SESSION_CHANGES_DRAFT_KIND, 'no_session_changes');

// --- Solver bookkeeping commits are not progress -------------------------

assert.equal(isSolverCommit({ subject: 'Initial commit with task details', files: ['.gitkeep'] }), true);
assert.equal(isSolverCommit({ subject: 'Revert "Initial commit with task details"', files: ['.gitkeep'] }), true);
assert.equal(isSolverCommit({ subject: 'Revert: Remove CLAUDE.md changes from initial commit', files: ['CLAUDE.md'] }), true);
assert.equal(isSolverCommit({ subject: 'Remove leftover .gitkeep (post-cleanup fallback)', files: ['.gitkeep'] }), true);
assert.equal(isSolverCommit({ subject: 'Add development log for issue #1 PR #2', files: ['dev/log/issues/1/pulls/2/session.md'] }), true);
assert.equal(isSolverCommit({ subject: 'Update notes', files: ['dev/log/issues/1/pulls/2/notes.md', '.formal-ai/plan.lino'] }), true, 'a commit that only touches the dev log or tool scratch is bookkeeping too');
assert.equal(isSolverCommit({ subject: 'Implement Hello World', files: ['Main.kt'] }), false);
assert.equal(isSolverCommit({ subject: 'Auto-commit: Changes made by Claude during problem-solving session', files: ['Main.kt'] }), false, 'auto-committed AI work is work');

// --- The /claude reproduction: 2 turns, WebFetch then text, nothing changed

{
  const state = reproductionRepo();
  const { $ } = await freshRun(state);

  // The recorded transcript, reduced to the lines that matter: one WebFetch call,
  // its result, and the final text that only restates it.
  const transcript = [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'call_9adcc7a68e77039a', name: 'WebFetch', input: { url: `https://github.com/${OWNER}/${REPO}/issues/1`, prompt: 'Issue to solve' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'call_9adcc7a68e77039a', content: 'Implement Hello World in Kotlin', is_error: false }] } },
    { type: 'result', subtype: 'success', is_error: false, num_turns: 2, result: 'The `WebFetch` command completed. Output:\n\n```text\nImplement Hello World in Kotlin\n```' },
  ];
  const breaker = createRepeatedToolCallBreaker({ limit: 0 });
  for (const event of transcript) assert.equal(breaker.observe(event), null, 'the breaker stays off (#2395)');

  // After the session, solve commits the development log - bookkeeping only.
  commit(state, 'devlog1', 'Add development log for issue #1 PR #2', ['dev/log/issues/1/pulls/2/session.md']);
  state.upstream = state.commits.length - 1;

  const outcome = await evaluateSessionChanges({ $, owner: OWNER, repo: REPO, prNumber: 2, issueNumber: 1, log });
  assert.equal(outcome.measured, true);
  assert.equal(outcome.progress, false, 'a development-log commit is not work');
  assert.equal(outcome.noChanges, true, 'two turns that changed nothing are not progress, whatever the pull request diff says');
  assert.match(outcome.reason, /produced no change/);
  assert.doesNotMatch(outcome.reason, /planned_not_executed/, 'a terminal state printed before this run started is not this run');

  // The PR was a draft before the run (a human draft, kept as one); session
  // start observes that state.
  await ensurePullRequestIsDraft({ owner: OWNER, repo: REPO, prNumber: 2, $, log });
  const reported = await reportSessionWithoutChanges({ owner: OWNER, repo: REPO, prNumber: 2, issueNumber: 1, $, log });
  assert.equal(reported.noChanges, true);
  assert.equal(reported.keepsDraft, true);
  assert.equal(getPullRequestLeftInDraft({ owner: OWNER, repo: REPO, prNumber: 2 })?.kind, NO_SESSION_CHANGES_DRAFT_KIND, 'the draft is a recorded decision');

  // Every later ready transition in this run respects it.
  const later = await ensurePullRequestIsReady({ owner: OWNER, repo: REPO, prNumber: 2, $, log, reason: 'solution draft verified', requireChanges: true, getChangeStats: async () => ({ measured: true, hasChanges: true }) });
  assert.equal(later.reason, 'left_in_draft_on_purpose');
  assert.equal(state.isDraft, true, 'the pull request is not converted to ready');
  assert.equal($.commands.filter(command => command.startsWith('gh pr ready') && !command.includes('--undo')).length, 0, 'no `gh pr ready` is issued');

  assert.equal($.posted.length, 1, 'the outcome is published on the pull request');
  assert.match($.posted[0], /⚠️ \*\*Finished without changes\*\*/);
  assert.match($.posted[0], /produced no change/);
  assert.ok(
    logs.some(line => line.includes('⚠️  Finished without changes')),
    'and in the log'
  );
  assert.ok(!logs.some(line => line.includes('🎉')), 'never 🎉');

  // Finalize re-measures the whole run before choosing the exit code.
  const atExit = await reevaluateRunWithoutChanges({ log });
  assert.equal(atExit?.noChanges, true, 'still nothing at run end: exit 5');
}

// --- Formal AI draft: the reason is its terminal state, not a tool error --

{
  const state = reproductionRepo();
  const { $ } = await freshRun(state, {
    logText: ['❌ Tool error: ENOENT reading .formal-ai/cache (unrelated)', '{"type":"result","result":"Plan event:\\n\\n```text\\ngeneral_change_plan\\n  terminal_state \\"planned_not_executed\\"\\n```"}', ''].join('\n'),
  });
  commit(state, 'devlog2', 'Add development log for issue #1 PR #2', ['dev/log/issues/1/pulls/2/session.md']);
  const outcome = await evaluateSessionChanges({ $, owner: OWNER, repo: REPO, prNumber: 2, issueNumber: 1, log });
  assert.equal(outcome.noChanges, true);
  assert.equal(outcome.terminalState, 'planned_not_executed');
  assert.equal(outcome.reason, 'Formal AI produced no change (terminal state: planned_not_executed)');
  assert.doesNotMatch(outcome.reason, /ENOENT/, 'the unrelated first tool error is not the reason');

  // The draft pull request this run created holds only the placeholder commit:
  // it is not readied for review, neither now nor by the run-end restore (#2312).
  markPullRequestCreatedByThisRun({ owner: OWNER, repo: REPO, prNumber: 2 });
  await ensurePullRequestIsDraft({ owner: OWNER, repo: REPO, prNumber: 2, $, log });
  const reported = await reportSessionWithoutChanges({ owner: OWNER, repo: REPO, prNumber: 2, issueNumber: 1, $, log });
  assert.equal(reported.keepsDraft, true);
  const [restored] = await restoreDeliberateDraftsAtRunEnd({ $, log });
  assert.equal(restored?.reason, 'no_session_changes');
  assert.equal(state.isDraft, true, 'a run that changed nothing does not end with its pull request ready for review');
}

assert.equal(extractFormalAiTerminalState('terminal_state "planned_not_executed"'), 'planned_not_executed');
assert.equal(extractFormalAiTerminalState('a\n  terminal_state \\"blocked\\"\nb terminal_state \\"planned_not_executed\\"'), 'planned_not_executed', 'the last state wins');
assert.equal(extractFormalAiTerminalState('"terminal_reason": "completed"'), null, "Claude's terminal_reason is not Formal AI's terminal state");

// --- An observed loop is part of the reason ------------------------------

{
  const state = reproductionRepo();
  const { $ } = await freshRun(state);
  const breaker = createRepeatedToolCallBreaker({ limit: 0 });
  for (let index = 0; index < 12; index++) breaker.recordCall({ tool: 'shell', input: { command: '/bin/bash -lc "gh issue view \'https://github.com/o/r/issues/1\' --json title --jq .title"' }, output: 'Implement Hello World in Rust\n' });
  const { classifySessionResult } = await import('../src/session-result.lib.mjs');
  await classifySessionResult({ toolResult: { success: true }, argv: {}, log });
  const outcome = await evaluateSessionChanges({ $, owner: OWNER, repo: REPO, prNumber: 2, issueNumber: 1, log });
  assert.equal(outcome.noChanges, true);
  assert.match(outcome.reason, /looped on `gh issue view 'https:\/\/github\.com\/o\/r\/issues\/1' --json title --jq \.title` 12 times/);
}

// --- Legitimate sessions without a new diff still count ------------------

{
  // A real commit.
  const state = reproductionRepo();
  const { $ } = await freshRun(state);
  commit(state, 'work001', 'Implement Hello World', ['Main.kt']);
  commit(state, 'devlog3', 'Add development log for issue #1 PR #2', ['dev/log/issues/1/pulls/2/session.md']);
  const outcome = await evaluateSessionChanges({ $, owner: OWNER, repo: REPO, prNumber: 2, issueNumber: 1, log });
  assert.equal(outcome.progress, true);
  assert.equal(outcome.noChanges, false);
}

{
  // Pushing work committed before the session: HEAD is unchanged, upstream moved.
  const state = reproductionRepo();
  commit(state, 'local01', 'Fix output format', ['Main.kt']);
  state.upstream = state.commits.length - 2;
  const { $ } = await freshRun(state);
  state.upstream = state.commits.length - 1;
  const outcome = await evaluateSessionChanges({ $, owner: OWNER, repo: REPO, prNumber: 2, issueNumber: 1, log });
  assert.equal(outcome.progress, true, 'publishing earlier work is progress');
}

{
  // An uncommitted edit (solve auto-commits or restarts on it later).
  const state = reproductionRepo();
  const { $ } = await freshRun(state);
  state.status = ' M Main.kt\n';
  const outcome = await evaluateSessionChanges({ $, owner: OWNER, repo: REPO, prNumber: 2, issueNumber: 1, log });
  assert.equal(outcome.progress, true);
}

{
  // Tool scratch and the dev log in the working tree are not progress.
  const state = reproductionRepo();
  const { $ } = await freshRun(state);
  state.status = '?? .formal-ai/\n?? dev/log/issues/1/pulls/2/\n';
  const outcome = await evaluateSessionChanges({ $, owner: OWNER, repo: REPO, prNumber: 2, issueNumber: 1, log });
  assert.equal(outcome.noChanges, true);
}

{
  // A comment-only answer (review-feedback mode).
  const state = reproductionRepo();
  const { $ } = await freshRun(state);
  state.comments = [
    { id: 1, user: { login: 'konard' }, created_at: new Date().toISOString(), body: 'The requested behaviour is already implemented in Main.kt line 3.' },
    { id: 2, user: { login: 'konard' }, created_at: new Date().toISOString(), body: '⚠️ **Finished without changes**' },
  ];
  const outcome = await evaluateSessionChanges({ $, owner: OWNER, repo: REPO, prNumber: 2, issueNumber: 1, log });
  assert.equal(outcome.progress, true, 'an AI comment is the work product of a review answer');
  assert.equal(outcome.evidence, 'comment');
}

{
  // A git failure is unmeasured, never "no change".
  const state = reproductionRepo();
  const { $ } = await freshRun(state);
  state.gitBroken = true;
  const outcome = await evaluateSessionChanges({ $, owner: OWNER, repo: REPO, prNumber: 2, issueNumber: 1, log });
  assert.equal(outcome.measured, false);
  assert.equal(outcome.noChanges, false);
}

{
  // No baseline (a path that never started a session) reports nothing.
  resetSessionChanges();
  const outcome = await evaluateSessionChanges({ $: makeFakeShell(reproductionRepo()), owner: OWNER, repo: REPO, prNumber: 2, log });
  assert.equal(outcome.noChanges, false);
  assert.equal(await reevaluateRunWithoutChanges({ log }), null);
}

// --- A pull request that was ready before the run keeps that state -------

{
  // `--auto-continue` / `--auto-merge` on a finished pull request: holding the
  // draft would make the auto-merge loop restart the AI over and over.
  const state = { ...reproductionRepo(), isDraft: false };
  const { $ } = await freshRun(state);
  await ensurePullRequestIsDraft({ owner: OWNER, repo: REPO, prNumber: 2, $, log });
  const reported = await reportSessionWithoutChanges({ owner: OWNER, repo: REPO, prNumber: 2, issueNumber: 1, $, log });
  assert.equal(reported.noChanges, true, 'it is still reported');
  assert.equal(reported.keepsDraft, false);
  assert.equal(getPullRequestLeftInDraft({ owner: OWNER, repo: REPO, prNumber: 2 }), null);
  assert.match($.posted[0], /ready for review before this run/);
}

{
  // A pull request merged during the run (auto-merge of finished work) is not a failure.
  const state = reproductionRepo();
  const { $ } = await freshRun(state);
  await reportSessionWithoutChanges({ owner: OWNER, repo: REPO, prNumber: 2, issueNumber: 1, $, log });
  state.prState = 'MERGED';
  assert.equal(await reevaluateRunWithoutChanges({ log }), null);
}

{
  // A later session (auto-restart) that commits real work clears the verdict.
  const state = reproductionRepo();
  const { $ } = await freshRun(state);
  await reportSessionWithoutChanges({ owner: OWNER, repo: REPO, prNumber: 2, issueNumber: 1, $, log });
  commit(state, 'work002', 'Implement Hello World', ['Main.kt']);
  assert.equal(await reevaluateRunWithoutChanges({ log }), null);
}

// --- The comment, the restart feedback, the marker -----------------------

assert.match(buildFinishedWithoutChangesComment({ reason: 'Formal AI produced no change (terminal state: planned_not_executed)', keepsDraft: true }), /was not marked ready for review/);
assert.ok(TOOL_GENERATED_COMMENT_MARKERS.includes(FINISHED_WITHOUT_CHANGES_MARKER), 'the notice is not mistaken for an AI comment');
{
  const feedback = buildDeliberateDraftFeedback({ kind: NO_SESSION_CHANGES_DRAFT_KIND, reason: 'Formal AI produced no change (terminal state: planned_not_executed)' });
  assert.match(feedback.restartReason, /made no change/);
  assert.ok(feedback.feedbackLines.join('\n').includes('planned_not_executed'));
  assert.doesNotMatch(feedback.restartReason, /failed:/, 'it is not described as a failed session');
}

// --- Telegram: exit code 5 of a solve session is ⚠️, not ✅ and not ❌ ------

{
  await initI18n('en');
  const message = formatSessionCompletionMessage({ sessionName: 's', sessionInfo: { command: 'solve', startTime: new Date(0) }, observedEndTime: new Date(259_000), exitCode: EXIT_CODE_SOLVE_NO_CHANGES });
  assert.match(message, /^⚠️ /);
  assert.match(message, /finished without changes/i);
  assert.doesNotMatch(message, /✅/);
  const hiveExit = formatSessionCompletionMessage({ sessionName: 's', sessionInfo: { command: 'hive', startTime: new Date(0) }, observedEndTime: new Date(1000), exitCode: 5 });
  assert.doesNotMatch(hiveExit, /without changes/i, 'the meaning of 5 is specific to solve');
}

// --- Wiring: every path goes through the measurement ---------------------

{
  const solve = readSrc('solve.mjs');
  assert.match(solve, /captureSessionChangeBaseline\(/, 'the baseline is taken when the session starts');
  assert.ok(solve.indexOf('captureSessionChangeBaseline(') < solve.indexOf('beginWorkingSession();'), 'before the AI tool runs');

  const results = readSrc('solve.results.lib.mjs');
  assert.match(results, /reportSessionWithoutChanges\(/);
  assert.match(results, /EXIT_CODE_SOLVE_NO_CHANGES/, 'verifyResults exits 5, not 0, when nothing changed');
  const successIndex = results.indexOf("'\\n🎉 SUCCESS: A solution draft has been prepared as a pull request'");
  assert.ok(successIndex > 0);
  assert.match(results.slice(successIndex - 200, successIndex), /noChanges/, '🎉 SUCCESS is conditional on progress');

  const finalize = readSrc('solve.finalize.lib.mjs');
  assert.match(finalize, /reevaluateRunWithoutChanges/);
  assert.ok(finalize.indexOf('reevaluateRunWithoutChanges') < finalize.indexOf('cleanupTempDirectory(tempDir'), 're-measured before the workspace is deleted');
  assert.match(finalize, /EXIT_CODE_SOLVE_NO_CHANGES/);

  const hive = readSrc('hive.mjs');
  assert.match(hive, /EXIT_CODE_SOLVE_NO_CHANGES/, 'hive does not throw on a worker that finished without changes');
}

rmSync(tempDir, { recursive: true, force: true });
resetSessionChanges();
resetWorkingSessionDrafts();
console.log('PASS: issue #3211 a session that changed nothing is not reported as success');
