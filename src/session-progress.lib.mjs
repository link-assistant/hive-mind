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
 * with - its final message plus the state of the working tree - and reports a
 * repeat so the caller can stop with the remaining budget unspent.
 *
 * `HEAD` is part of the fingerprint as well: a session that commits has made
 * progress even when its final message and its (now clean) `git status` look
 * the same as the previous one's.
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
 * @see https://github.com/link-assistant/hive-mind/issues/2247
 */

import { createHash } from 'node:crypto';

import { commitUncommittedChangesOnCriticalError } from './critical-error-commit.lib.mjs';
import { filterAiToolScratchFromStatus } from './ai-tool-scratch.lib.mjs';
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
 * Hash what a session ended with.
 *
 * @param {Object} [params]
 * @param {string} [params.finalMessage] - the session's final assistant message
 * @param {string} [params.gitStatus] - `git status --porcelain`, scratch already filtered
 * @param {string} [params.head] - the commit the branch points at afterwards
 * @returns {string} short hex digest
 */
export const buildSessionFingerprint = ({ finalMessage = '', gitStatus = '', head = '' } = {}) =>
  createHash('sha256')
    .update([normalizeSessionMessage(finalMessage), normalizeSessionMessage(gitStatus), String(head ?? '').trim()].join(FINGERPRINT_SEPARATOR))
    .digest('hex')
    .slice(0, 16);

let sessions = [];
let lastVerdict = null;

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
 * @returns {{fingerprint: string, repeated: boolean, previous: Object|null, current: Object, occurrences: number}}
 */
export const recordSessionOutcome = ({ finalMessage = '', gitStatus = '', head = '', sessionId = null, logFile = null, label = null } = {}) => {
  const fingerprint = buildSessionFingerprint({ finalMessage, gitStatus, head });
  const previous = sessions.length > 0 ? sessions[sessions.length - 1] : null;
  const current = { fingerprint, sessionId, logFile, label, finalMessage: normalizeSessionMessage(finalMessage), gitStatus: String(gitStatus ?? '').trim(), head: String(head ?? '').trim() };
  sessions.push(current);
  const occurrences = sessions.filter(entry => entry.fingerprint === fingerprint).length;
  // Only a session identical to the one immediately before it is a stall. A
  // fingerprint that comes back after real work happened in between is a
  // revert, not a loop, and the next session may well do something else.
  lastVerdict = { fingerprint, repeated: previous !== null && previous.fingerprint === fingerprint, previous, current, occurrences };
  return lastVerdict;
};

/** The verdict for the most recently recorded session, or null before the first. */
export const getLastSessionProgress = () => lastVerdict;

export const getRecordedSessions = () => sessions.map(entry => ({ ...entry }));

/** Reset the record. Intended for tests and for a new logical run. */
export const resetSessionProgress = () => {
  sessions = [];
  lastVerdict = null;
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
 * @param {boolean} [params.verbose]
 * @param {Function} [params.log]
 * @returns {Promise<Object>} the reporter's result
 */
export const reportNoProgressStop = async ({ $: command, owner, repo, targetNumber, mode = null, verdict = null, remainingIterations = null, verbose = false, log = noopLog }) =>
  reportAutomationStop({
    $: command,
    owner,
    repo,
    targetNumber,
    reason: NO_PROGRESS_STOP_REASON,
    mode,
    message: 'Two consecutive AI sessions ended with the same final message, the same working tree and the same commit, so another restart cannot produce a different result.',
    details: buildNoProgressDetails({ previous: verdict?.previous, current: verdict?.current, remainingIterations }),
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

  const preserved = await commitUncommittedChangesOnCriticalError({ tempDir, branchName, $: command, log, reason: 'stopped after two identical AI sessions', push: true });

  if (prNumber) {
    await reportNoProgressStop({ $: command, owner, repo, targetNumber: prNumber, mode, verdict, remainingIterations, verbose, log });
  }

  noProgressFailure = { reason: NO_PROGRESS_STOP_REASON, committed: preserved.committed, pushed: preserved.pushed, occurrences: verdict?.occurrences || 2 };
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
 *   differed from the one before it and the loop should continue
 */
export const stopWhenSessionRepeated = async ({ owner, repo, prNumber, tempDir, branchName, $: command, log = noopLog, formatAligned, mode = null, verbose = false }) => {
  const verdict = getLastSessionProgress();
  if (!verdict?.repeated) return null;
  return await failOnNoProgressBetweenSessions({ owner, repo, prNumber, tempDir, branchName, $: command, log, formatAligned, verdict, mode, remainingIterations: getRemainingAutoRestartIterations(), verbose });
};

export default { NO_PROGRESS_STOP_REASON, buildNoProgressDetails, buildSessionFingerprint, captureSessionOutcome, failOnNoProgressBetweenSessions, getLastSessionProgress, getNoProgressFailure, getRecordedSessions, hasNoProgressFailure, normalizeSessionMessage, recordSessionOutcome, reportNoProgressStop, resetNoProgressFailure, resetSessionProgress, stopWhenSessionRepeated };
