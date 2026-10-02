#!/usr/bin/env node
/**
 * Target-branch CI gate for the Telegram merge queue.
 *
 * Issue #2404: the queue used to check the default branch's CI health once,
 * before it started. When the HEAD commit's CI was still running it returned
 * "healthy" and then only waited for the active runs to *finish* — it never
 * looked at how they *concluded*. A red main (e.g. `Checks and release` →
 * failure) was therefore merged on top of.
 *
 * This gate runs before every merge: it checks the HEAD commit's CI, waits for
 * active runs when needed, and re-checks the conclusions after each wait. It
 * only lets the queue proceed when the branch CI is known not to be red. A HEAD
 * without CI of its own (e.g. a release version bump) is judged by the newest
 * ancestor that has CI — see github-branch-ci-health.lib.mjs.
 *
 * Split from telegram-merge-queue.lib.mjs to keep that file under the
 * repository line limit.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2404
 * @see https://github.com/link-assistant/hive-mind/issues/1341
 * @see https://github.com/link-assistant/hive-mind/issues/1425
 */

// Each round = one health check + (optionally) one wait for active runs. More than one round
// is only needed when new commits land on the branch while we wait, or while a just-pushed
// HEAD has no runs registered yet.
export const MAX_BRANCH_GATE_ROUNDS = 10;
// Pause before re-checking when HEAD is "pending" but there were no active runs to wait for
// (GitHub has not registered the runs of a just-pushed commit yet).
export const BRANCH_GATE_RECHECK_DELAY_MS = 30 * 1000;

/**
 * Ensure the target branch is safe to merge into.
 *
 * @param {Object} processor - MergeQueueProcessor-like object (owner, repo, verbose, isCancelled,
 *   log(), sleep(), getDefaultBranch(), checkBranchCIHealth(), waitForTargetBranchCI())
 * @param {Object} options
 * @param {boolean} options.checkHealth - Verify CI conclusions on the branch HEAD (CHECK_BRANCH_CI_HEALTH_BEFORE_START)
 * @param {boolean} options.waitForActiveRuns - Wait for active runs on the branch (WAIT_FOR_TARGET_BRANCH_CI)
 * @param {string} options.context - Human-readable context for logs, e.g. "before merging PR #12"
 * @returns {Promise<{ok: boolean, status: 'ready'|'failed'|'pending'|'cancelled', failedRuns: Array, error: string|null}>}
 */
export async function ensureTargetBranchReady(processor, { checkHealth, waitForActiveRuns, context }) {
  const ready = { ok: true, status: 'ready', failedRuns: [], error: null };
  const cancelled = { ok: false, status: 'cancelled', failedRuns: [], error: 'Cancelled' };
  if (!checkHealth && !waitForActiveRuns) return ready;

  let branch = 'main';
  try {
    branch = await processor.getDefaultBranch(processor.owner, processor.repo, processor.verbose);
  } catch (error) {
    processor.log(`Branch gate (${context}): could not resolve default branch (${error.message}), assuming '${branch}'`);
  }

  let health = null;
  for (let round = 1; round <= MAX_BRANCH_GATE_ROUNDS; round++) {
    if (processor.isCancelled) return cancelled;

    if (checkHealth) {
      processor.log(`Branch gate (${context}): checking CI health of ${branch} HEAD (round ${round}/${MAX_BRANCH_GATE_ROUNDS})...`);
      health = await processor.checkBranchCIHealth(processor.owner, processor.repo, branch, {}, processor.verbose);
      if (!health.healthy) {
        processor.log(`Branch gate (${context}): ${branch} is red — ${health.error}`);
        return { ok: false, status: 'failed', failedRuns: health.failedRuns || [], error: health.error };
      }
      const at = health.checkedSha ? ` (judged on ${health.checkedSha.substring(0, 7)}${health.skippedCommits ? `, skipped ${health.skippedCommits} commit(s) without CI` : ''})` : '';
      processor.log(`Branch gate (${context}): ${branch} HEAD CI ${health.pending ? `has ${health.pendingRuns?.length || 0} run(s) in progress` : 'is green'}${at}`);
    }

    if (!waitForActiveRuns) {
      if (health?.pending) processor.log(`Branch gate (${context}): waiting for target-branch CI is disabled; proceeding while ${branch} HEAD CI is still running`);
      return ready;
    }

    const wait = await processor.waitForTargetBranchCI();
    if (processor.isCancelled) return cancelled;
    processor.log(`Branch gate (${context}): wait result success=${wait.success} waitedForRuns=${wait.waitedForRuns} completedRuns=${wait.completedRuns}${wait.error ? ` error=${wait.error}` : ''}`);

    // Without the health check we keep the legacy behaviour: wait, then proceed.
    if (!checkHealth) return ready;
    // Nothing was running and the HEAD commit was already settled: nothing new to verify.
    if (!wait.waitedForRuns && !health.pending && wait.success) return ready;

    if (!wait.success) {
      // Timed out (or the final poll failed). Only the HEAD commit's verdict matters now.
      health = await processor.checkBranchCIHealth(processor.owner, processor.repo, branch, {}, processor.verbose);
      if (!health.healthy) {
        return { ok: false, status: 'failed', failedRuns: health.failedRuns || [], error: health.error };
      }
      if (health.pending) {
        const names = (health.pendingRuns || []).map(run => run.name).join(', ');
        return { ok: false, status: 'pending', failedRuns: [], error: `CI on ${branch} is still running after waiting (${names || wait.error}); cannot confirm ${branch} is green` };
      }
      processor.log(`Branch gate (${context}): ${branch} HEAD CI is green; other active runs did not finish (${wait.error}). Proceeding.`);
      return ready;
    }
    if (!wait.waitedForRuns && health.pending) {
      // HEAD is pending but nothing was running yet: give GitHub time to register its runs.
      processor.log(`Branch gate (${context}): ${branch} HEAD has no active runs yet; re-checking in ${BRANCH_GATE_RECHECK_DELAY_MS / 1000}s`);
      await processor.sleep(BRANCH_GATE_RECHECK_DELAY_MS);
    }
    // Runs finished while we waited — loop to re-check their conclusions (issue #2404).
  }

  return { ok: false, status: 'pending', failedRuns: [], error: `CI on ${branch} kept changing after ${MAX_BRANCH_GATE_ROUNDS} checks; cannot confirm ${branch} is green` };
}

export default {
  ensureTargetBranchReady,
  MAX_BRANCH_GATE_ROUNDS,
  BRANCH_GATE_RECHECK_DELAY_MS,
};
