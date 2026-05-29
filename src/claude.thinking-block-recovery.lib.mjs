#!/usr/bin/env node

// Issue #1834: recovery for corrupted extended-thinking blocks.
//
// When extended thinking is combined with tool use, Claude Code can persist a thinking block to the
// on-disk session transcript with the `thinking` text emptied to "" while keeping the original
// `signature`. On resume/continue the API validates the signature against the now-empty text and
// rejects the turn with a 400:
//   API Error: 400 ... `thinking` or `redacted_thinking` blocks in the latest assistant message
//   cannot be modified. These blocks must remain as they were in the original response.
// Upstream: https://github.com/anthropics/claude-code/issues/63147
//
// PR #1835 feedback: "in case of this specific error we should try resume first, and if not possible
// try to restart." Recovery is therefore a two-phase escalation:
//   Phase 1 — REPAIR the on-disk transcript (strip the corrupted empty-text thinking blocks) and
//             resume the existing session (context-preserving). Plain resume of a poisoned
//             transcript is futile — the 400 just repeats — so we first remove the offending blocks,
//             which the API permits omitting. When repair succeeds the resume keeps all accumulated
//             text/tool-use history (Issue #1834 "can we do even better?").
//   Phase 2 — repair/resume unavailable or already failed → discard the session and start fresh.
// On every attempt we first auto-commit any uncommitted work (Issue #1834 / PR #1835 feedback:
// "on all critical errors we auto commit uncommitted changes by default") so nothing is lost when
// the session context resets.

import { retryLimits, criticalErrorRecovery } from './config.lib.mjs';
import { waitWithCountdown } from './tool-retry.lib.mjs';
import { commitUncommittedChangesOnCriticalError } from './critical-error-commit.lib.mjs';
import { repairCorruptedThinkingBlocks } from './claude.session-transcript-repair.lib.mjs';

/**
 * Create a stateful corrupted-thinking-block recovery handler. The returned function persists its
 * resume/restart counters across calls (so the caps survive recursive retries) and mutates
 * `argv.resume` to drive the next session: setting it to the session id resumes, clearing it forces
 * a fresh session.
 *
 * @param {object} ctx
 * @param {object} ctx.argv - parsed CLI args (argv.resume is mutated to choose resume vs fresh).
 * @param {string} ctx.tempDir - working tree for auto-committing uncommitted work.
 * @param {string} [ctx.branchName] - branch to push preserved work to.
 * @param {Function} ctx.$ - command-stream executor.
 * @param {Function} ctx.log - async logger.
 * @param {number} [ctx.waitMs=5000] - settle delay before re-running (overridable for tests).
 * @param {Function} [ctx.repair=repairCorruptedThinkingBlocks] - transcript repair (injectable for tests).
 * @param {string} [ctx.homeDir] - override home dir for transcript lookup (tests).
 * @returns {(opts: {classified: object, source: string, sessionId: string|null}) => Promise<boolean>}
 *          Resolves true when a recovery attempt was initiated (caller should re-run); false when
 *          both caps are exhausted (caller should fail).
 */
export const createThinkingBlockRecovery = ({ argv, tempDir, branchName, $, log, waitMs = 5000, repair = repairCorruptedThinkingBlocks, homeDir }) => {
  let resumeCount = 0;
  let restartCount = 0;
  return async ({ classified, source, sessionId }) => {
    const preserveWork = async () => {
      if (criticalErrorRecovery.autoCommitUncommittedChanges) {
        await commitUncommittedChangesOnCriticalError({ tempDir, branchName, $, log, reason: `${classified.label} (${source})` });
      }
    };
    // Phase 1 — repair the on-disk transcript, then resume (keeps accumulated context).
    if (sessionId && resumeCount < retryLimits.maxThinkingBlockResumes) {
      resumeCount++;
      await preserveWork();
      await log(`\n⚠️ ${classified.label} (${source}). Resume attempt ${resumeCount}/${retryLimits.maxThinkingBlockResumes} — repairing the corrupted transcript then resuming the existing session before discarding it (Issue #1834)...`, { level: 'warning' });
      // Strip the corrupted (empty-text) thinking blocks so resume isn't doomed to repeat the 400.
      try {
        const repairResult = await repair({ tempDir, sessionId, homeDir, log });
        if (repairResult?.repaired) {
          await log(`   🩹 Stripped ${repairResult.removedBlocks} corrupted thinking block(s) from the transcript — resume will preserve context (Issue #1834).`, { verbose: true });
        } else {
          await log(`   ℹ️ Transcript repair made no change (${repairResult?.reason || 'unknown'}) — resuming as-is (Issue #1834).`, { verbose: true });
        }
      } catch {
        // Repair must never block recovery — fall through to a plain resume attempt.
      }
      argv.resume = sessionId;
      await waitWithCountdown(waitMs, log);
      await log('\n🔄 Resuming the session now...');
      return true;
    }
    // Phase 2 — resume not possible / already failed → discard the session and start fresh.
    if (restartCount < retryLimits.maxThinkingBlockRestarts) {
      restartCount++;
      await preserveWork();
      await log(`\n⚠️ ${classified.label} (${source}). Resume not possible — restart ${restartCount}/${retryLimits.maxThinkingBlockRestarts} with a fresh session (Issue #1834)...`, { level: 'warning' });
      await log(`   Discarding session ${argv.resume || sessionId || '(none)'} and starting fresh — the corrupted thinking blocks can never be replayed (upstream anthropics/claude-code#63147).`, { verbose: true });
      // Force a fresh session — do NOT resume the corrupted one, otherwise the 400 repeats forever.
      argv.resume = undefined;
      await waitWithCountdown(waitMs, log);
      await log('\n🔄 Restarting with a fresh session now...');
      return true;
    }
    await log(`\n\n❌ Corrupted thinking blocks persisted after ${resumeCount} resume + ${restartCount} fresh-session attempt(s) (Issue #1834).\n   This is an upstream Claude Code bug (anthropics/claude-code#63147). Failing to avoid an endless recovery loop.`, { level: 'error' });
    return false;
  };
};

export default { createThinkingBlockRecovery };
