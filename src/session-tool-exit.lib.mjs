/**
 * Which process an exit code belongs to (issue #3435).
 *
 * A killed work session reports two exit codes that are both true: solve's own
 * (the command start-command ran, e.g. `1`) and the AI tool's (e.g. the Claude
 * CLI SIGKILLed by the cgroup OOM killer, `137`). The failure comment named
 * 137 and the kill notice said "Exit code: 1", for the same session, without
 * saying which process each number came from.
 *
 * This module reads the AI tool's own exit line from the end of the solve log
 * and renders one exit line that names both processes:
 *
 *   Exit code: 1 (solve); the AI tool (claude) exited 137 (SIGKILL, cgroup OOM)
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3435
 */

import { readLogTailText } from './log-bounded-read.lib.mjs';

/** How much of the log end to scan; the tool exit line is near the end. */
export const TOOL_EXIT_TAIL_BYTES = 256 * 1024;

// The tool labels as written by claude.lib.mjs, claude.connection.lib.mjs,
// codex.lib.mjs, gemini.lib.mjs, opencode.lib.mjs and qwen.lib.mjs.
const TOOL_IDS = Object.freeze({ Claude: 'claude', 'Claude CLI': 'claude', Codex: 'codex', Gemini: 'gemini', OpenCode: 'opencode', 'Qwen Code': 'qwen' });

// Anchored at the line start (after solve's optional `[timestamp] [LEVEL] `
// prefixes), so AI output that quotes such a line is not taken for it.
const TOOL_EXIT_LINE = /^(?:\[[^\]]*\] )*\s*❌ (Claude CLI|Claude|Codex|Gemini|OpenCode|Qwen Code) (?:command|CLI) failed with exit code (-?\d+)\b/;

/**
 * Find the last AI tool exit line in a log excerpt.
 *
 * @param {string} text
 * @returns {{tool: string, label: string, exitCode: number, line: string}|null}
 */
export function findToolExitCode(text) {
  if (!text) return null;
  const lines = String(text).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = TOOL_EXIT_LINE.exec(lines[i].replace(/\r$/, ''));
    if (match) return { tool: TOOL_IDS[match[1]], label: match[1], exitCode: Number(match[2]), line: lines[i].trim() };
  }
  return null;
}

// Issue #3435 (side risk): solve's in-process SIGKILL recovery
// (solve.tool-kill-resume.lib.mjs) posts its own "Working process killed"
// comment and logs `[HIVE-MIND RECOVERY] {"kind":"tool",...}` records.
const RECOVERY_RECORD_LINE = /^(?:\[[^\]]*\] )*\[HIVE-MIND RECOVERY\] (\{.*\})\r?$/;
const SPENT_BUDGET_REASON = /budget \d+\/([1-9]\d*) is spent/;

/**
 * Whether solve already reported an AI tool kill on GitHub itself.
 *
 * True for a `waiting` record (the kill comment is posted just before it), any
 * record carrying the comment URL, or a `failed` record for a spent non-zero
 * budget (the "budget is spent" comment). A zero budget posts nothing.
 *
 * @param {string} text - Log excerpt
 * @returns {{phase: string, attempt: number, commentUrl: string|null}|null} The last such record
 */
export function findInProcessKillReport(text) {
  if (!text) return null;
  let found = null;
  for (const line of String(text).split('\n')) {
    const match = RECOVERY_RECORD_LINE.exec(line);
    if (!match) continue;
    let event;
    try {
      event = JSON.parse(match[1]);
    } catch {
      continue;
    }
    if (event?.kind !== 'tool') continue;
    const reported = event.phase === 'waiting' || typeof event.commentUrl === 'string' || (event.phase === 'failed' && SPENT_BUDGET_REASON.test(String(event.reason || '')));
    if (reported) found = { phase: event.phase, attempt: Number(event.attempt) || 0, commentUrl: typeof event.commentUrl === 'string' ? event.commentUrl : null };
  }
  return found;
}

async function readToolExitTail(logPath, { readFile, minByteOffset }) {
  return readFile
    ? Buffer.from(String((await readFile(logPath, 'utf8')) || ''))
        .subarray(minByteOffset)
        .toString('utf8')
        .slice(-TOOL_EXIT_TAIL_BYTES)
    : readLogTailText(logPath, { maxBytes: TOOL_EXIT_TAIL_BYTES, minByteOffset });
}

/**
 * One bounded log-tail read for both the AI tool exit line and solve's own
 * in-process kill report. Never throws.
 *
 * @param {string|null} logPath
 * @param {Object} [options] - Same as {@link detectToolExitCode}
 * @returns {Promise<{toolExit: Object|null, inProcessKillReport: Object|null}>}
 */
export async function detectToolExitEvidence(logPath, { readFile = null, minByteOffset = 0, verbose = false } = {}) {
  const none = { toolExit: null, inProcessKillReport: null };
  if (!logPath) return none;
  try {
    const text = await readToolExitTail(logPath, { readFile, minByteOffset });
    const toolExit = findToolExitCode(text);
    const inProcessKillReport = findInProcessKillReport(text);
    if (verbose) console.log(`[VERBOSE] AI tool exit scan of ${logPath}: ${toolExit ? `${toolExit.tool} exited ${toolExit.exitCode}` : 'none found'}${inProcessKillReport ? `; solve already reported the kill (${inProcessKillReport.phase})` : ''} (issue #3435)`);
    return { toolExit, inProcessKillReport };
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] AI tool exit scan of ${logPath} failed: ${error?.message || error}`);
    return none;
  }
}

/**
 * Read the log tail and find the AI tool's exit line. Never throws.
 *
 * @param {string|null} logPath
 * @param {Object} [options]
 * @param {Function|null} [options.readFile] - Test seam returning the whole log text
 * @param {number} [options.minByteOffset] - Ignore what an earlier attempt wrote
 * @param {boolean} [options.verbose]
 * @returns {Promise<{tool: string, label: string, exitCode: number, line: string}|null>}
 */
export async function detectToolExitCode(logPath, options = {}) {
  return (await detectToolExitEvidence(logPath, options)).toolExit;
}

const SIGNALS = Object.freeze({ 129: 'SIGHUP', 130: 'SIGINT', 134: 'SIGABRT', 137: 'SIGKILL', 139: 'SIGSEGV', 143: 'SIGTERM' });

/**
 * The signal behind a shell-style exit code (128 + N), or null.
 *
 * @param {number|null} exitCode
 * @returns {string|null}
 */
export function exitCodeSignal(exitCode) {
  return SIGNALS[Number(exitCode)] || null;
}

// Causes that rule out the OOM killer as the sender of a SIGKILL.
const NON_OOM_CAUSES = new Set(['disk-full', 'forced-kill', 'host-reboot', 'docker-daemon-restart']);

function describeCode(exitCode, { label = null, oomEvidence = false, cause = null } = {}) {
  const notes = [];
  if (label) notes.push(label);
  const signal = exitCodeSignal(exitCode);
  if (signal) notes.push(signal);
  // "cgroup OOM" only with evidence of a container OOM event, and only when
  // the diagnosis did not name another cause for the kill.
  if (Number(exitCode) === 137 && oomEvidence && !NON_OOM_CAUSES.has(cause)) notes.push('cgroup OOM');
  return notes.length > 0 ? `${exitCode} (${notes.join(', ')})` : String(exitCode);
}

/**
 * One exit line naming the process each code belongs to.
 *
 * @param {Object} options
 * @param {number|null} options.exitCode - The work session's own exit code
 * @param {string} [options.processLabel] - The command start-command ran (e.g. `solve`)
 * @param {{tool: string, exitCode: number}|null} [options.toolExit] - From {@link detectToolExitCode}
 * @param {boolean} [options.oomEvidence] - A container OOM event was observed
 * @param {string|null} [options.cause] - The kill diagnosis cause
 * @returns {string|null} e.g. `1 (solve); the AI tool (claude) exited 137 (SIGKILL, cgroup OOM)`
 */
export function describeSessionExitCodes({ exitCode = null, processLabel = 'solve', toolExit = null, oomEvidence = false, cause = null } = {}) {
  if (exitCode === null || exitCode === undefined) return null;
  const own = describeCode(exitCode, { label: processLabel || 'solve', oomEvidence, cause });
  if (!toolExit || !Number.isFinite(Number(toolExit.exitCode))) return own;
  return `${own}; the AI tool (${toolExit.tool || 'unknown'}) exited ${describeCode(toolExit.exitCode, { oomEvidence, cause })}`;
}
