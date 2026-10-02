/**
 * Resume the AI tool in-process when its process was killed (issue #2408).
 *
 * In link-foundation/meta-language#196 a `cargo build` run by Claude inside the
 * working container drove the container out of memory at 13:37:15; the kernel
 * SIGKILLed it, Claude exited 137 twenty seconds later, and the
 * `--auto-restart-until-mergeable` loop treated that like any other tool
 * failure: "❌ CLAUDE EXECUTION FAILED — Stopping auto-restart". The whole
 * container then exited 1, and the bot had no recovery attempt left.
 *
 * A process killed by SIGKILL (exit 128 + 9) did not fail at the task: it was
 * stopped from outside. The AI session it belonged to is intact on disk, so the
 * cheapest, most faithful recovery is to resume that very session — same
 * container, same clone, same log — with a note asking for lower memory use.
 * The attempts are bounded by `--session-kill-resume-attempts` (default 3), the
 * same budget the Telegram bot uses when a whole working session is killed, and
 * each kill is announced on the pull request as a ⚠️ warning, not a failure.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2408
 */

import { resolveSessionKillResumeAttempts } from './session-kill-policy.lib.mjs';
import { postTrackedComment } from './tool-comments.lib.mjs';

/** 128 + SIGKILL(9): what a shell reports for a process the OOM killer ended. */
export const SIGKILL_EXIT_CODE = 137;

/** The feedback the resumed AI session receives. */
export const TOOL_KILL_RESUME_FEEDBACK = 'Continue. Your previous run was killed with SIGKILL (exit code 137) — most likely by the out-of-memory killer while a memory-hungry command (for example a parallel `cargo build` or test run) was running. Continue from where you stopped, and prefer lower-memory commands (for example `cargo build -j 1`, `CARGO_BUILD_JOBS=1`, or running one test target at a time).';

/**
 * Whether a failed tool result describes a process killed by SIGKILL rather
 * than a tool that failed by itself.
 *
 * @param {Object|null} toolResult
 * @returns {boolean}
 */
export function isToolProcessKilled(toolResult) {
  if (!toolResult || toolResult.success || toolResult.limitReached) return false;
  const exitCode = toolResult.exitCode ?? toolResult.errorInfo?.exitCode ?? null;
  return Number(exitCode) === SIGKILL_EXIT_CODE || toolResult.signal === 'SIGKILL' || toolResult.errorInfo?.signal === 'SIGKILL';
}

/**
 * Markdown for the pull-request warning posted when the tool process is killed.
 *
 * @param {Object} options
 * @returns {string}
 */
export function buildToolKillWarningComment({ tool = 'claude', sessionId = null, attempt = 1, maxAttempts = 1, resuming = true } = {}) {
  const toolName = String(tool || 'claude').toUpperCase();
  const lines = ['## ⚠️ Working process killed (exit code 137, likely out of memory)', '', `The ${toolName} process was killed with SIGKILL (exit code ${SIGKILL_EXIT_CODE}), which almost always means the out-of-memory killer ended it or a memory-hungry child process. This is a warning, not a failure of the work itself.`, ''];
  if (resuming && sessionId) {
    lines.push(`Hive Mind is **automatically resuming** the same ${toolName} session \`${sessionId}\` in the same working directory (attempt ${attempt}/${maxAttempts}), asking it to use less memory.`);
  } else if (resuming) {
    lines.push(`No ${toolName} session id was recorded, so Hive Mind **automatically restarts** the work in the same working directory (attempt ${attempt}/${maxAttempts}).`);
  } else {
    lines.push(`The automatic recovery budget (${maxAttempts}) is spent, so the work stops here. Raise \`--session-kill-resume-attempts\` or reduce the memory the build needs, then re-run the command.`);
  }
  lines.push('', '<sub>Reported by Hive Mind (issue #2408)</sub>');
  return lines.join('\n');
}

/**
 * Resume the tool after it was killed, as long as the budget allows. Never
 * throws: a failed resume leaves the last result for the caller's failure path.
 *
 * @param {Object} options
 * @param {Object} options.toolResult - The failed iteration result
 * @param {number} options.attemptsUsed - Kill resumes already spent in this run
 * @param {Object} options.argv
 * @param {Function} options.runIteration - `({ argv, feedbackLines }) => Promise<toolResult>`
 * @param {Object} [options.env]
 * @param {Function} [options.$] - command-stream `$`, to post the warning
 * @param {string} [options.owner]
 * @param {string} [options.repo]
 * @param {number} [options.prNumber]
 * @param {Function} [options.log]
 * @param {Function} [options.postComment] - Test seam for postTrackedComment
 * @returns {Promise<{toolResult: Object, attemptsUsed: number, resumed: boolean}>}
 */
export async function resumeAfterToolKill({ toolResult, attemptsUsed = 0, argv = {}, runIteration, env = process.env, $ = null, owner = null, repo = null, prNumber = null, log = async () => {}, postComment = postTrackedComment } = {}) {
  let result = toolResult;
  let used = attemptsUsed;
  let resumed = false;
  const maxAttempts = resolveSessionKillResumeAttempts({ argv, env });
  const announce = async body => {
    if (!$ || !owner || !repo || !prNumber) return;
    try {
      await postComment({ $, owner, repo, targetNumber: prNumber, body });
    } catch (error) {
      await log(`   ⚠️  Could not post the process-kill warning: ${error?.message || error}`);
    }
  };

  while (isToolProcessKilled(result)) {
    const sessionId = result.sessionId || null;
    if (used >= maxAttempts || typeof runIteration !== 'function') {
      await log(`\n⚠️  ${String(argv.tool || 'claude').toUpperCase()} process killed (exit code ${SIGKILL_EXIT_CODE}); automatic recovery budget ${used}/${maxAttempts} is spent (issue #2408)`);
      if (maxAttempts > 0) await announce(buildToolKillWarningComment({ tool: argv.tool, sessionId, attempt: used, maxAttempts, resuming: false }));
      break;
    }
    used++;
    await log(`\n⚠️  ${String(argv.tool || 'claude').toUpperCase()} process killed (exit code ${SIGKILL_EXIT_CODE}, likely out of memory) — ${sessionId ? `resuming session ${sessionId}` : 'restarting'} automatically (attempt ${used}/${maxAttempts}, issue #2408)`);
    await announce(buildToolKillWarningComment({ tool: argv.tool, sessionId, attempt: used, maxAttempts, resuming: true }));
    try {
      result = await runIteration({ argv: sessionId ? { ...argv, resume: sessionId } : argv, feedbackLines: [TOOL_KILL_RESUME_FEEDBACK] });
      resumed = true;
    } catch (error) {
      await log(`   ⚠️  Automatic resume after the process kill failed: ${error?.message || error}`);
      break;
    }
  }
  return { toolResult: result, attemptsUsed: used, resumed };
}

export default { SIGKILL_EXIT_CODE, TOOL_KILL_RESUME_FEEDBACK, isToolProcessKilled, buildToolKillWarningComment, resumeAfterToolKill };
