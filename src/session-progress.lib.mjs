#!/usr/bin/env node

/**
 * Issue #2247 (H3): stop restarting a session that produces the same outcome.
 *
 * Two of the three 2026-09-13 `--model formal-ai` reproduction runs restarted
 * five times, and each restart was byte-identical to the one before it:
 *
 *   - Scala (`--tool agent`): every session wrote `Main.scala`, failed to run
 *     it (`/bin/sh: 1: scala: not found`), reported "Created and verified" and
 *     committed nothing, so `git status --porcelain` kept reporting the same
 *     single untracked file and the loop kept firing;
 *   - Rust (`--tool codex`): every session echoed the same raw issue JSON and
 *     changed nothing at all.
 *
 * Ten AI sessions were paid for, and the tenth had exactly the same information
 * the first one had. A restart is only worth its cost when something changed
 * between the two sessions, so this module fingerprints what a session ended
 * with - the state of the working tree - and reports a repeat so the caller
 * can stop with the remaining budget unspent.
 *
 * `HEAD` is part of the fingerprint as well: a session that commits has made
 * progress even when its (now clean) `git status` looks the same as the
 * previous one's.
 *
 * Scratch directories are filtered out for the reason spelled out in
 * `src/ai-tool-scratch.lib.mjs`: `.formal-ai/` is rewritten by every session,
 * so an unfiltered status would make two identical sessions look different and
 * defeat the whole check - on exactly the runs that motivated it.
 *
 * The record is a module-level singleton for the same reason
 * `src/auto-restart-budget.lib.mjs` is one: the primary session, the watch loop
 * and the auto-merge loop are separate modules invoked in sequence by
 * `solve.mjs`, they never see each other's state, and one `solve` process
 * handles exactly one logical run.
 *
 * Issue #2313: an identical outcome only proves "no progress" when the second
 * session was given a different input. In the 2026-09-27 Kotlin run Formal AI
 * got a byte-identical prompt on every restart, so the stop described solve's
 * own input, not the model. Each session's input (the feedback lines it was
 * started with, minus the restart counter) is fingerprinted too. When the
 * outcome repeats after an unchanged input, the loop changes the input - it
 * tells the next session that the previous two ended identically - instead of
 * stopping; only a repeat after a changed input stops the run.
 *
 * Issue #2839: the final message is NOT part of the fingerprint. In the
 * 2026-10-09 stylist-svelte run (`--tool codex`) restarts 2/5-5/5 all started
 * and ended on `edee6d7` with a clean tree, yet the breaker never fired: the
 * model paraphrased the same blocker every time ("CI remains blocked:
 * `modules/business` is inaccessible..." / "...still returns 404..."), and a
 * word-for-word hash of free text treats every paraphrase as progress. What a
 * session can actually change is the branch (`HEAD`) and the working tree, so
 * only those are compared. The failing checks the next session would be asked
 * to fix are a function of `HEAD` (CI runs on that commit) and are part of the
 * session's input fingerprint through its feedback lines. The message is still
 * recorded, for the stop comment and the escalation prompt.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2247
 * @see https://github.com/link-assistant/hive-mind/issues/2313
 * @see https://github.com/link-assistant/hive-mind/issues/2839
 */

import { createHash } from 'node:crypto';

import { commitUncommittedChangesOnCriticalError, describePreservedWork } from './critical-error-commit.lib.mjs';
import { filterAiToolScratchFromStatus } from './ai-tool-scratch.lib.mjs';
import { ensurePullRequestStaysDraftAfterFailure } from './pr-draft-state.lib.mjs';
import { reportAutomationStop } from './automation-stop-reporting.lib.mjs';
import { getRemainingAutoRestartIterations } from './auto-restart-budget.lib.mjs';

/** Stop reason published through the #2144 automation-stop registry. */
export const NO_PROGRESS_STOP_REASON = 'no_progress_between_sessions';

/** NUL cannot occur in a commit hash, a status line, or a chat message. */
const FINGERPRINT_SEPARATOR = String.fromCharCode(0);
const STATUS_PREVIEW_LINES = 10;

const noopLog = async () => {};

/** Collapse whitespace so cosmetic reflow is not read as a different answer. */
export const normalizeSessionMessage = text =>
  String(text ?? '')
    .replace(/\s+/gu, ' ')
    .trim();

/**
 * Hash what a session ended with: the working tree and the commit.
 *
 * Issue #2839: `finalMessage` is accepted (callers pass the whole outcome) but
 * deliberately ignored - a paraphrase of the same blocker is not progress.
 *
 * @param {Object} [params]
 * @param {string} [params.gitStatus] - `git status --porcelain`, scratch already filtered
 * @param {string} [params.head] - the commit the branch points at afterwards
 * @returns {string} short hex digest
 */
export const buildSessionFingerprint = ({ gitStatus = '', head = '' } = {}) =>
  createHash('sha256')
    .update([normalizeSessionMessage(gitStatus), String(head ?? '').trim()].join(FINGERPRINT_SEPARATOR))
    .digest('hex')
    .slice(0, 16);

/**
 * Fingerprint the input a session was started with. The restart counter
 * (`Auto-restart 2/5`) is not a change a model can act on, so it is ignored.
 *
 * @param {string[]|null} [feedbackLines]
 * @returns {string} short hex digest ('' for no feedback at all)
 */
export const buildSessionInputFingerprint = (feedbackLines = []) => {
  const text = normalizeSessionMessage((feedbackLines || []).join('\n').replace(/\(?(Auto-)?restart \d+(\/\d+)?\)?/giu, ''));
  return text ? createHash('sha256').update(text).digest('hex').slice(0, 16) : '';
};

let sessions = [];
let lastVerdict = null;
let pendingInput = '';
let pendingEscalation = null;

/**
 * Remember the input of the session that is about to start; the next
 * `recordSessionOutcome` attaches it to that session's outcome.
 *
 * @param {string[]|null} [feedbackLines]
 */
export const noteSessionInput = feedbackLines => {
  pendingInput = buildSessionInputFingerprint(feedbackLines);
};

/**
 * Record what one AI session ended with.
 *
 * @param {Object} params
 * @param {string} [params.finalMessage]
 * @param {string} [params.gitStatus]
 * @param {string} [params.head]
 * @param {string|null} [params.sessionId]
 * @param {string|null} [params.logFile] - this session's log, named in the stop comment
 * @param {string|null} [params.label] - e.g. `Auto-restart 2/5`
 * @param {string} [params.input] - input fingerprint, defaults to the last `noteSessionInput`
 * @returns {{fingerprint: string, repeated: boolean, inputChanged: boolean, previous: Object|null, current: Object, occurrences: number}}
 */
export const recordSessionOutcome = ({ finalMessage = '', gitStatus = '', head = '', sessionId = null, logFile = null, label = null, input = pendingInput } = {}) => {
  const fingerprint = buildSessionFingerprint({ gitStatus, head });
  const previous = sessions.length > 0 ? sessions[sessions.length - 1] : null;
  const current = { fingerprint, input, sessionId, logFile, label, finalMessage: normalizeSessionMessage(finalMessage), gitStatus: String(gitStatus ?? '').trim(), head: String(head ?? '').trim() };
  pendingInput = '';
  sessions.push(current);
  const occurrences = sessions.filter(entry => entry.fingerprint === fingerprint).length;
  // Only a session identical to the one immediately before it is a stall. A
  // fingerprint that comes back after real work happened in between is a
  // revert, not a loop, and the next session may well do something else.
  lastVerdict = { fingerprint, repeated: previous !== null && previous.fingerprint === fingerprint, inputChanged: previous !== null && previous.input !== input, previous, current, occurrences };
  return lastVerdict;
};

/** The verdict for the most recently recorded session, or null before the first. */
export const getLastSessionProgress = () => lastVerdict;

export const getRecordedSessions = () => sessions.map(entry => ({ ...entry }));

/** Reset the record. Intended for tests and for a new logical run. */
export const resetSessionProgress = () => {
  sessions = [];
  lastVerdict = null;
  pendingInput = '';
  pendingEscalation = null;
};

/**
 * The lines that change the next session's input after two identical sessions
 * that were given the same input (#2313).
 *
 * @param {Object|null} verdict - from `recordSessionOutcome`
 * @returns {string[]}
 */
export const buildRepeatedSessionFeedback = verdict => {
  const lines = ['', '🔁 THE LAST TWO WORKING SESSIONS ENDED IDENTICALLY:', 'They received the same instructions and ended with the same working tree and the same commit. Repeating the same steps will not change the result.'];
  if (verdict?.current?.finalMessage) lines.push(`The last final message was: ${verdict.current.finalMessage.slice(0, 500)}`);
  const status = String(verdict?.current?.gitStatus || '').trim();
  if (status) lines.push('Both left this `git status --porcelain` output:', '```', ...status.split('\n').slice(0, STATUS_PREVIEW_LINES), '```');
  lines.push('Find out why the previous approach did not work and resolve the blocker with a different approach before you finish.');
  return lines;
};

/**
 * Take (once) the feedback queued by `stopWhenSessionRepeated` for the next
 * session. Every restart funnels through `executeToolIteration`, which appends it.
 *
 * @returns {string[]}
 */
export const takeRepeatedSessionFeedback = () => {
  const verdict = pendingEscalation;
  pendingEscalation = null;
  return verdict ? buildRepeatedSessionFeedback(verdict) : [];
};

/**
 * Read the working tree and record this session's outcome. Never throws: a
 * progress check that fails must not take the session down with it.
 *
 * @param {Object} params
 * @param {string} params.tempDir - the task workspace
 * @param {Object|null} [params.toolResult] - the runner's return value
 * @param {Function} params.$ - command-stream tagged template
 * @param {Function} [params.log]
 * @param {string|null} [params.logFile]
 * @param {string|null} [params.label]
 * @returns {Promise<Object|null>} the verdict from `recordSessionOutcome`
 */
export const captureSessionOutcome = async ({ tempDir, toolResult = null, $: command, log = noopLog, logFile = null, label = null } = {}) => {
  if (!tempDir || typeof command !== 'function') return null;
  const finalMessage = toolResult?.resultSummary || toolResult?.errorInfo?.message || toolResult?.lastMessage || '';
  let gitStatus = '';
  let head = '';
  try {
    const statusResult = await command({ cwd: tempDir })`git status --porcelain 2>&1`;
    if (statusResult?.code === 0) gitStatus = filterAiToolScratchFromStatus(statusResult.stdout.toString().trim());
    const headResult = await command({ cwd: tempDir })`git rev-parse HEAD 2>&1`;
    if (headResult?.code === 0) head = headResult.stdout.toString().trim();
  } catch (error) {
    // An unreadable working tree means an unusable fingerprint. Recording one
    // anyway would compare two unknowns and could stop a healthy run.
    await log(`⚠️  Session progress check skipped: ${error.message}`, { verbose: true });
    return null;
  }
  return recordSessionOutcome({ finalMessage, gitStatus, head, sessionId: toolResult?.sessionId || null, logFile, label });
};

const describeSession = (entry, fallback) => {
  const parts = [];
  if (entry?.label) parts.push(entry.label);
  if (entry?.sessionId) parts.push(`session \`${entry.sessionId}\``);
  if (entry?.logFile) parts.push(`log \`${entry.logFile}\``);
  return parts.length > 0 ? parts.join(', ') : fallback;
};

/**
 * Evidence lines for the stop comment: both sessions, and what they left behind.
 *
 * @param {Object} params
 * @param {Object|null} [params.previous]
 * @param {Object|null} [params.current]
 * @param {number|null} [params.remainingIterations] - budget deliberately left unused
 * @returns {string[]}
 */
export const buildNoProgressDetails = ({ previous = null, current = null, remainingIterations = null } = {}) => {
  const details = [`Previous session: ${describeSession(previous, 'not recorded')}`, `Identical session: ${describeSession(current, 'not recorded')}`];
  const status = String(current?.gitStatus || '').trim();
  if (status) {
    const lines = status.split('\n');
    const shown = lines.slice(0, STATUS_PREVIEW_LINES).join('\n');
    const omitted = lines.length > STATUS_PREVIEW_LINES ? `\n... and ${lines.length - STATUS_PREVIEW_LINES} more` : '';
    details.push(`Both sessions ended with the same working tree:\n\`\`\`\n${shown}${omitted}\n\`\`\``);
  } else {
    details.push('Neither session left anything uncommitted in the working tree.');
  }
  if (current?.head) details.push(`Both sessions ended on the same commit: \`${current.head}\`.`);
  if (typeof remainingIterations === 'number' && remainingIterations > 0) {
    details.push(`${remainingIterations} restart iteration${remainingIterations === 1 ? '' : 's'} of the configured budget ${remainingIterations === 1 ? 'was' : 'were'} left unused: another identical session would cost the same and end the same way.`);
  }
  return details;
};

/**
 * Publish the stop through the shared #2144 reporter, which deduplicates by
 * reason, so the run posts exactly one "no progress" comment.
 *
 * @param {Object} params
 * @param {Function} params.$
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number|string} params.targetNumber
 * @param {string} [params.mode] - which loop stopped
 * @param {Object|null} [params.verdict] - from `recordSessionOutcome`
 * @param {number|null} [params.remainingIterations]
 * @param {Object|null} [params.preserved] - from `commitUncommittedChangesOnCriticalError`
 * @param {boolean} [params.verbose]
 * @param {Function} [params.log]
 * @returns {Promise<Object>} the reporter's result
 */
export const reportNoProgressStop = async ({ $: command, owner, repo, targetNumber, mode = null, verdict = null, remainingIterations = null, preserved = null, verbose = false, log = noopLog }) =>
  reportAutomationStop({
    $: command,
    owner,
    repo,
    targetNumber,
    reason: NO_PROGRESS_STOP_REASON,
    mode,
    message: 'Two consecutive AI sessions ended with the same working tree and the same commit although the second one was given different instructions, so another restart cannot produce a different result.',
    // Issue #2315: say where the uncommitted work went (never the PR branch).
    details: [...buildNoProgressDetails({ previous: verdict?.previous, current: verdict?.current, remainingIterations }), ...(preserved ? [describePreservedWork(preserved)] : [])],
    verbose,
    log,
  });

// Recorded like `auto-restart-exhaustion.lib.mjs` records its own failure, and
// for the same reason: `solve.mjs` runs the two restart loops in sequence and
// neither returns through a common result object, so this is what lets
// `finalizeSolveProcess` exit non-zero instead of reporting a successful run.
let noProgressFailure = null;

/** @returns {boolean} true once a restart loop stopped for lack of progress */
export const hasNoProgressFailure = () => Boolean(noProgressFailure);

/** @returns {{reason: string, committed: boolean, pushed: boolean, occurrences: number}|null} */
export const getNoProgressFailure = () => noProgressFailure;

/** Clear the recorded failure. Intended for tests. */
export const resetNoProgressFailure = () => {
  noProgressFailure = null;
};

/**
 * Stop the run because the last two AI sessions were identical.
 *
 * Mirrors `failOnAutoRestartBudgetExhausted`: log it, preserve whatever the
 * sessions left uncommitted (the Scala run's `Main.scala` was never committed
 * and died with its temporary clone), publish one comment, and record the
 * failure so the process exits non-zero.
 *
 * Never throws: a failed commit or comment must not mask the stop itself.
 *
 * @param {Object} params
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number|null} params.prNumber - comment skipped when absent
 * @param {string} params.tempDir
 * @param {string|null} params.branchName
 * @param {Function} params.$
 * @param {Function} params.log
 * @param {Function} params.formatAligned
 * @param {Object|null} params.verdict - from `recordSessionOutcome`
 * @param {string} [params.mode] - which loop stopped
 * @param {number|null} [params.remainingIterations]
 * @param {boolean} [params.verbose]
 * @returns {Promise<{reason: string, committed: boolean, pushed: boolean, occurrences: number}>}
 */
export const failOnNoProgressBetweenSessions = async ({ owner, repo, prNumber, tempDir, branchName, $: command, log = noopLog, formatAligned = (icon, label, value) => `${icon} ${label} ${value}`, verdict = null, mode = null, remainingIterations = null, verbose = false }) => {
  await log('');
  await log(formatAligned('❌', 'NO PROGRESS BETWEEN SESSIONS', 'Stopping instead of repeating an identical session'), { level: 'error' });
  await log(formatAligned('', 'Previous session:', describeSession(verdict?.previous, 'not recorded'), 2), { level: 'error' });
  await log(formatAligned('', 'Identical session:', describeSession(verdict?.current, 'not recorded'), 2), { level: 'error' });
  if (typeof remainingIterations === 'number' && remainingIterations > 0) {
    await log(formatAligned('', 'Budget left unused:', `${remainingIterations} restart iteration${remainingIterations === 1 ? '' : 's'}`, 2), { level: 'error' });
  }
  await log('');

  // Issue #2263: terminal failure must dominate any earlier readiness decision,
  // including the restart iteration's own finally block.
  if (prNumber) {
    await ensurePullRequestStaysDraftAfterFailure({ owner, repo, prNumber, $: command, log, formatAligned, reason: 'no progress between sessions' });
  }

  const preserved = await commitUncommittedChangesOnCriticalError({ tempDir, branchName, $: command, log, reason: 'stopped after two identical AI sessions', push: true });

  if (prNumber) {
    await reportNoProgressStop({ $: command, owner, repo, targetNumber: prNumber, mode, verdict, remainingIterations, preserved, verbose, log });
  }

  noProgressFailure = { reason: NO_PROGRESS_STOP_REASON, committed: preserved.committed, pushed: preserved.pushed, recoveryBranch: preserved.recoveryBranch || null, occurrences: verdict?.occurrences || 2 };
  return noProgressFailure;
};

/**
 * The guard both restart loops run before spending an iteration.
 *
 * `watchUntilMergeable` and the watch loop reached the same conclusion the same
 * way in the 2026-09-13 runs - five identical sessions each - so they ask the
 * same question here rather than each keeping their own copy of it.
 *
 * @param {Object} params - as {@link failOnNoProgressBetweenSessions}, minus
 *   the verdict and the remaining budget, which are read from this module and
 *   from the shared restart budget.
 * @returns {Promise<Object|null>} the stop, or null when the last session
 *   differed from the one before it, or was given the same input as the one
 *   before it (the next input then changes), and the loop should continue
 */
export const stopWhenSessionRepeated = async ({ owner, repo, prNumber, tempDir, branchName, $: command, log = noopLog, formatAligned = (icon, label, value) => `${icon} ${label} ${value}`, mode = null, verbose = false }) => {
  const verdict = getLastSessionProgress();
  if (!verdict?.repeated) return null;
  // Issue #2313: the same input produced the same outcome - that says nothing
  // about the model. Change the input before concluding there is no progress.
  if (!verdict.inputChanged) {
    pendingEscalation = verdict;
    await log(formatAligned('🔁', 'Same input, same outcome:', 'the next session is told that the last two sessions ended identically', 2));
    return null;
  }
  return await failOnNoProgressBetweenSessions({ owner, repo, prNumber, tempDir, branchName, $: command, log, formatAligned, verdict, mode, remainingIterations: getRemainingAutoRestartIterations(), verbose });
};

export default { NO_PROGRESS_STOP_REASON, buildNoProgressDetails, buildRepeatedSessionFeedback, buildSessionFingerprint, buildSessionInputFingerprint, captureSessionOutcome, failOnNoProgressBetweenSessions, getLastSessionProgress, getNoProgressFailure, getRecordedSessions, hasNoProgressFailure, normalizeSessionMessage, noteSessionInput, recordSessionOutcome, reportNoProgressStop, resetNoProgressFailure, resetSessionProgress, stopWhenSessionRepeated, takeRepeatedSessionFeedback };
