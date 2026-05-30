#!/usr/bin/env node

// Issue #1841: recovery for context-window-exhausted failures. Two failure modes share this recovery:
//
//   1. "Prompt is too long" (`terminal_reason: blocking_limit`) — the context window filled up, Claude
//      Code triggered its built-in auto-compaction (`system` event `status: compacting`), the
//      compaction FAILED (`compact_result: failed`, `compact_error: too_few_groups`), and the next API
//      call returned the synthetic error "Prompt is too long" (`error: invalid_request`).
//   2. "Autocompact is thrashing" (`terminal_reason: rapid_refill_breaker`) — a large file read or
//      tool output kept refilling the context to the limit within a few turns of each compaction, so
//      Claude Code tripped its rapid-refill breaker and emitted a synthetic "Autocompact is thrashing
//      … use /clear to start fresh" message (`error: invalid_request`).
//
// In both cases the failed run exited with code 1 before this recovery was added.
//
// Root cause is on Claude Code's side: auto-compaction normally prevents this, but it summarizes the
// transcript with a smaller-context model and can itself overflow / refuse when the history cannot be
// grouped (`too_few_groups` — typically one oversized turn dominating the window). This is reported
// upstream multiple times: anthropics/claude-code#46348, #23751, #26317, #25620, #24976.
// Claude Code's official error reference (https://code.claude.com/docs/en/errors) confirms the only
// recoveries are `/compact` (already failed here) or `/clear` (fresh session), and that in
// non-interactive mode "the run aborts because the transcript only grows and retrying cannot succeed."
//
// What hive-mind can do: resuming the SAME session is futile — the on-disk transcript only grows, so
// the next prompt is the oversized one again and "Prompt is too long" repeats forever. The single
// recovery that can make progress is to discard the session and start FRESH (equivalent to `/clear`).
// A fresh `solve` session re-reads the issue/PR/branch state from GitHub and git, so the agent picks
// up the already-committed work and continues — provided we first preserve any uncommitted work
// (Issue #1834 / PR #1835 feedback: "on all critical errors we auto commit uncommitted changes by
// default"). Restarts are capped to avoid an expensive re-run loop when even a fresh session
// immediately overflows (e.g. the issue context alone is too large).

import { retryLimits, criticalErrorRecovery } from './config.lib.mjs';
import { waitWithCountdown } from './tool-retry.lib.mjs';
import { commitUncommittedChangesOnCriticalError } from './critical-error-commit.lib.mjs';

/**
 * Create a stateful context-limit ("Prompt is too long") recovery handler. The returned function
 * persists its restart counter across calls (so the cap survives recursive retries) and mutates
 * `argv.resume` to force a FRESH session — it never resumes the over-long transcript, which would
 * just replay the same oversized prompt.
 *
 * @param {object} ctx
 * @param {object} ctx.argv - parsed CLI args (argv.resume is cleared to force a fresh session).
 * @param {string} ctx.tempDir - working tree for auto-committing uncommitted work before restart.
 * @param {string} [ctx.branchName] - branch to push preserved work to.
 * @param {Function} ctx.$ - command-stream executor.
 * @param {Function} ctx.log - async logger.
 * @param {number} [ctx.waitMs=5000] - settle delay before re-running (overridable for tests).
 * @returns {(opts: {classified: object, source: string, sessionId: string|null}) => Promise<boolean>}
 *          Resolves true when a fresh-restart was initiated (caller should re-run); false when the
 *          restart cap is exhausted (caller should fail).
 */
export const createContextLimitRecovery = ({ argv, tempDir, branchName, $, log, waitMs = 5000 }) => {
  let restartCount = 0;
  return async ({ classified, source, sessionId }) => {
    const preserveWork = async () => {
      if (criticalErrorRecovery.autoCommitUncommittedChanges) {
        await commitUncommittedChangesOnCriticalError({ tempDir, branchName, $, log, reason: `${classified.label} (${source})` });
      }
    };
    if (restartCount < retryLimits.maxContextLimitRestarts) {
      restartCount++;
      await preserveWork();
      await log(`\n⚠️ ${classified.label} (${source}). Restart ${restartCount}/${retryLimits.maxContextLimitRestarts} with a fresh session (Issue #1841)...`, { level: 'warning' });
      await log(`   Claude Code auto-compaction could not reduce the prompt (upstream anthropics/claude-code#46348). Resuming would replay the same over-long transcript, so discarding session ${argv.resume || sessionId || '(none)'} and starting fresh — the fresh session re-reads the issue/PR and continues from the committed work.`, { verbose: true });
      // Force a fresh session — do NOT resume the over-long one, otherwise "Prompt is too long" repeats.
      argv.resume = undefined;
      await waitWithCountdown(waitMs, log);
      await log('\n🔄 Restarting with a fresh session now...');
      return true;
    }
    await log(`\n\n❌ Context-limit failure (${classified.label}) persisted after ${restartCount} fresh-session restart(s) (Issue #1841).\n   Claude Code's auto-compaction could not keep the context under the window (upstream anthropics/claude-code#46348) and a fresh session still overflowed — the issue/PR context alone may exceed the window, or a single file/tool output is too large. Failing to avoid an endless recovery loop.`, { level: 'error' });
    return false;
  };
};

export default { createContextLimitRecovery };
