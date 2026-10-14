#!/usr/bin/env node

/**
 * Issue #3211: success requires progress by this run.
 *
 * A `/claude … --model formal-ai` run made two turns (one `WebFetch`, then a
 * text that restated it), committed nothing, changed no file and posted no
 * comment - and was reported as `🎉 SUCCESS`, its pull request converted to
 * ready for review. The #2247 guard did run, but it measures the pull request's
 * diff against its base branch, and that pull request already had seven commits
 * from earlier sessions. A codex run that executed the same `gh issue view` 73
 * times ended the same way.
 *
 * What this run changed is measured against a baseline recorded when its first
 * working session starts:
 *
 *   - the branch head and its upstream: a new commit counts unless it is solver
 *     bookkeeping (the "Initial commit with task details" placeholder, its
 *     revert, the development log); pushing work committed earlier counts;
 *   - the working tree (`git status --porcelain`, AI tool scratch and the
 *     development log excluded): an uncommitted edit counts;
 *   - comments the AI posted (a review answer is the work product of a
 *     comment-only session).
 *
 * When none of them moved, the run "finished without changes": the log and the
 * pull request say so, the pull request is not converted to ready, and solve
 * exits with {@link EXIT_CODE_SOLVE_NO_CHANGES} instead of 0, which Telegram
 * shows as ⚠️ and hive does not count as a failed worker.
 *
 * Anything that cannot be measured (a git error, no baseline) is never reported
 * as "no change": a false "nothing happened" on finished work is worse than a
 * missed report.
 *
 * Exit codes of `solve` are documented in solve.exit-codes.lib.mjs.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3211
 * @module session-changes
 */

import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs';

import { isAiToolScratchPath } from './ai-tool-scratch.lib.mjs';
import { getInitialDraftState, markPullRequestLeftInDraft } from './pr-draft-state.lib.mjs';
import { describeObservedToolCallLoop, getObservedToolCallLoopHistory } from './repeated-tool-call-breaker.lib.mjs';
import { checkForAiCreatedComments } from './solve.session-comments.lib.mjs';
import { FINISHED_WITHOUT_CHANGES_MARKER, postTrackedComment } from './tool-comments.lib.mjs';
import { EXIT_CODE_SOLVE_NO_CHANGES } from './solve.exit-codes.lib.mjs';

export { EXIT_CODE_SOLVE_NO_CHANGES };

/** Deliberate-draft kind recorded in pr-draft-state.lib.mjs. */
export const NO_SESSION_CHANGES_DRAFT_KIND = 'no_session_changes';

/** The tail of this run's log searched for a Formal AI terminal state. */
const LOG_TAIL_BYTES = 8 * 1024 * 1024;

const QUIET = { mirror: false, capture: true };
const noopLog = async () => {};

/** Commits solve itself makes around a working session; none of them is work. */
const SOLVER_COMMIT_SUBJECTS = [/^Initial commit with task details/, /^Revert "Initial commit with task details/, /^Revert: Remove .* from initial commit/, /^Remove leftover .*\(post-cleanup fallback\)/, /^Add development log for /, /^Remove temporary CLAUDE\.md copy from AGENTS\.md/];

const isBookkeepingPath = filePath => filePath.startsWith('dev/log/') || isAiToolScratchPath(`?? ${filePath}`);

/**
 * @param {{subject: string, files: string[]}} commit
 * @returns {boolean} true for solver bookkeeping, false for work
 */
export const isSolverCommit = ({ subject = '', files = [] } = {}) => {
  if (SOLVER_COMMIT_SUBJECTS.some(pattern => pattern.test(subject))) return true;
  return files.length > 0 && files.every(isBookkeepingPath);
};

/** The last Formal AI `terminal_state` in a log excerpt (plain, quoted or JSON-escaped). */
export const extractFormalAiTerminalState = text => {
  if (typeof text !== 'string') return null;
  let state = null;
  for (const match of text.matchAll(/terminal_state["\\\s:=]+([a-z][a-z_]*)/g)) state = match[1];
  return state;
};

let baseline = null;
let verdict = null;

/** Forget the baseline and the verdict (tests; a new process starts clean anyway). */
export const resetSessionChanges = () => {
  baseline = null;
  verdict = null;
};

const readText = async (run, command) => {
  const result = await run;
  if (result?.code !== 0) throw new Error(`${command} exited with code ${result?.code}`);
  return (result.stdout ?? '').toString();
};

const git = ({ $, tempDir }) => {
  const run = $({ cwd: tempDir, ...QUIET });
  return {
    head: () => readText(run`git rev-parse HEAD`, 'git rev-parse HEAD').then(text => text.trim()),
    // `@{u}` does not exist before the first push; that is "no upstream", not an error.
    upstream: async () => {
      const result = await run`git rev-parse --verify -q @{u}`;
      return result?.code === 0 ? (result.stdout ?? '').toString().trim() || null : null;
    },
    status: () =>
      readText(run`git status --porcelain`, 'git status').then(text =>
        text
          .split('\n')
          .filter(line => line.trim() && !isAiToolScratchPath(line) && !isBookkeepingPath(line.slice(3).trim()))
          .sort()
          .join('\n')
      ),
    commits: async (from, to) => {
      const text = await readText(run`git log --format=%x1e%s --name-only ${`${from}..${to}`}`, 'git log');
      return text
        .split('\u001e')
        .filter(chunk => chunk.trim())
        .map(chunk => {
          const [subject, ...files] = chunk.split('\n');
          return { subject: subject.trim(), files: files.map(file => file.trim()).filter(Boolean) };
        });
    },
  };
};

const logSize = logFile => {
  try {
    return logFile && existsSync(logFile) ? statSync(logFile).size : 0;
  } catch {
    return 0;
  }
};

/** What this run wrote to its log since the baseline (its last {@link LOG_TAIL_BYTES}). */
const readRunLog = () => {
  if (!baseline?.logFile) return '';
  try {
    const end = logSize(baseline.logFile);
    const start = Math.max(baseline.logOffset, end - LOG_TAIL_BYTES);
    if (end <= start) return '';
    const buffer = Buffer.alloc(end - start);
    const fd = openSync(baseline.logFile, 'r');
    try {
      readSync(fd, buffer, 0, buffer.length, start);
    } finally {
      closeSync(fd);
    }
    return buffer.toString('utf8');
  } catch {
    return '';
  }
};

/**
 * Record where the run starts from. Only the first call of a run counts: the
 * question is whether the run, not its last session, changed anything.
 *
 * @returns {Promise<Object|null>} the baseline, or null when it cannot be read
 */
export const captureSessionChangeBaseline = async ({ tempDir, $, log = noopLog, logFile = null, owner = null, repo = null, issueNumber = null, prNumber = null, now = new Date() } = {}) => {
  if (baseline) return baseline;
  if (!tempDir || typeof $ !== 'function') return null;
  try {
    const repoGit = git({ $, tempDir });
    baseline = { tempDir, $, owner, repo, issueNumber, prNumber, logFile, logOffset: logSize(logFile), startedAt: now, head: await repoGit.head(), upstream: await repoGit.upstream(), status: await repoGit.status() };
    await log(`📌 Session change baseline: HEAD ${baseline.head.slice(0, 12)}, upstream ${baseline.upstream ? baseline.upstream.slice(0, 12) : 'none'}, ${baseline.status ? baseline.status.split('\n').length : 0} changed path(s)`, { verbose: true });
    return baseline;
  } catch (error) {
    baseline = null;
    await log(`⚠️  Session change baseline not recorded: ${error.message}`, { verbose: true });
    return null;
  }
};

/** Whether `from..to` contains a commit that is work. History rewritten past `from` counts as work. */
const rangeHasWork = async (repoGit, from, to) => {
  if (!to || from === to) return false;
  if (!from) return true;
  const commits = await repoGit.commits(from, to);
  return commits.length === 0 || commits.some(commit => !isSolverCommit(commit));
};

const describeLoops = () => {
  const loops = getObservedToolCallLoopHistory();
  if (loops.length === 0) return '';
  const worst = loops.reduce((best, loop) => (loop.count > best.count ? loop : best));
  return `; it ${describeObservedToolCallLoop(worst)}`;
};

/**
 * Compare the run's current state with its baseline.
 *
 * @returns {Promise<{measured: boolean, progress: boolean, noChanges: boolean, evidence: (string|null), reason: (string|null), terminalState: (string|null)}>}
 */
export const evaluateSessionChanges = async ({ owner, repo, prNumber = null, issueNumber = null, $, log = noopLog } = {}) => {
  const unmeasured = { measured: false, progress: false, noChanges: false, evidence: null, reason: null, terminalState: null };
  if (!baseline) return unmeasured;
  const run$ = typeof $ === 'function' ? $ : baseline.$;
  let evidence = null;
  try {
    const repoGit = git({ $: run$, tempDir: baseline.tempDir });
    const [head, upstream, status] = [await repoGit.head(), await repoGit.upstream(), await repoGit.status()];
    if (await rangeHasWork(repoGit, baseline.head, head)) evidence = 'commit';
    else if (upstream && upstream !== baseline.upstream && (await rangeHasWork(repoGit, baseline.upstream || baseline.head, upstream))) evidence = 'push';
    else if (status !== baseline.status) evidence = 'working_tree';
  } catch (error) {
    await log(`⚠️  Could not measure what this run changed: ${error.message}`, { verbose: true });
    return unmeasured;
  }
  if (!evidence) {
    const commented = await checkForAiCreatedComments({ sessionStartTime: baseline.startedAt, owner: owner || baseline.owner, repo: repo || baseline.repo, prNumber: prNumber || baseline.prNumber, issueNumber: issueNumber || baseline.issueNumber, $: run$, log });
    if (commented) evidence = 'comment';
  }
  if (evidence) return { measured: true, progress: true, noChanges: false, evidence, reason: null, terminalState: null };
  const terminalState = extractFormalAiTerminalState(readRunLog());
  const cause = terminalState ? `Formal AI produced no change (terminal state: ${terminalState})` : 'the session produced no change: no new commit, no file change and no comment';
  return { measured: true, progress: false, noChanges: true, evidence: null, reason: `${cause}${describeLoops()}`, terminalState };
};

export const buildFinishedWithoutChangesComment = ({ reason, keepsDraft = true }) => [`⚠️ **${FINISHED_WITHOUT_CHANGES_MARKER}**`, '', `This run made no commit, changed no file and posted no comment. Reason: ${reason}.`, '', keepsDraft ? 'Nothing new is here to review, so it was not marked ready for review.' : 'The pull request was ready for review before this run, so it keeps that state.', 'Check the session log for what the session did, then rerun the solver or continue manually.'].join('\n');

/**
 * Called by verifyResults() before the pull request would be marked ready.
 *
 * A pull request that was ready for review before the run is not held in
 * draft: that would undo its pre-run state and, under `--auto-merge`, restart
 * the AI on finished work. The outcome is still reported and the exit code is
 * still {@link EXIT_CODE_SOLVE_NO_CHANGES}.
 *
 * @returns {Promise<{noChanges: boolean, reason: (string|null), keepsDraft: boolean, exitCode: number}>}
 */
export const reportSessionWithoutChanges = async ({ owner, repo, prNumber, issueNumber = null, $, log = noopLog }) => {
  const outcome = await evaluateSessionChanges({ owner, repo, prNumber, issueNumber, $, log });
  if (!outcome.noChanges) {
    verdict = null;
    return { noChanges: false, reason: null, keepsDraft: false, exitCode: 0 };
  }
  await log(`\n⚠️  Finished without changes: ${outcome.reason}`, { level: 'warning' });
  const keepsDraft = getInitialDraftState({ owner, repo, prNumber })?.isDraft !== false;
  if (keepsDraft) markPullRequestLeftInDraft({ owner, repo, prNumber, reason: outcome.reason, kind: NO_SESSION_CHANGES_DRAFT_KIND });
  try {
    const { ok, stderr } = (await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body: buildFinishedWithoutChangesComment({ reason: outcome.reason, keepsDraft }) })) || {};
    if (!ok) await log(`  ⚠️  Could not post the finished-without-changes notice: ${stderr || 'unknown error'}`, { level: 'warning' });
  } catch (error) {
    await log(`  ⚠️  Could not post the finished-without-changes notice: ${error.message}`, { level: 'warning' });
  }
  verdict = { noChanges: true, reason: outcome.reason, owner, repo, prNumber, issueNumber, $ };
  return { noChanges: true, reason: outcome.reason, keepsDraft, exitCode: EXIT_CODE_SOLVE_NO_CHANGES };
};

/**
 * Called when the run ends: a later session (watch, auto-restart) may have done
 * the work after all, and a merged pull request is a finished task.
 *
 * @returns {Promise<{noChanges: true, reason: string}|null>} null when the run may exit 0
 */
export const reevaluateRunWithoutChanges = async ({ log = noopLog } = {}) => {
  if (!verdict?.noChanges) return null;
  const { owner, repo, prNumber, issueNumber, $ } = verdict;
  try {
    const view = await $(QUIET)`gh pr view ${prNumber} --repo ${owner}/${repo} --json state`;
    if (view?.code === 0 && JSON.parse((view.stdout ?? '').toString() || '{}').state === 'MERGED') {
      await log(`  ℹ️  PR #${prNumber} was merged during the run`, { verbose: true });
      verdict = null;
      return null;
    }
  } catch {
    // An unreadable state is not "merged"; the measurement below decides.
  }
  const outcome = await evaluateSessionChanges({ owner, repo, prNumber, issueNumber, $, log });
  if (!outcome.noChanges) {
    verdict = null;
    return null;
  }
  return { noChanges: true, reason: outcome.reason };
};

export default { buildFinishedWithoutChangesComment, captureSessionChangeBaseline, evaluateSessionChanges, EXIT_CODE_SOLVE_NO_CHANGES, extractFormalAiTerminalState, isSolverCommit, NO_SESSION_CHANGES_DRAFT_KIND, reevaluateRunWithoutChanges, reportSessionWithoutChanges, resetSessionChanges };
