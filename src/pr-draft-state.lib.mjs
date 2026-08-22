/**
 * Single source of truth for pull request draft/ready state transitions.
 *
 * Issue #2123: every place that starts, restarts or resumes a working session must
 * put the pull request back into draft mode (if it is not already a draft), and every
 * place that ends a working session must convert it back to ready for review.
 *
 * Before this module the logic was duplicated inline in solve.session.lib.mjs and was
 * gated behind `argv.watch || argv.autoContinue`, so auto-restart / auto-resume
 * sessions (temporary watch mode, auto-restart-until-mergeable, escalate,
 * keep-working, auto-ensure, PR-placeholder restart) kept the PR marked as
 * "ready for review" while the AI was actively working on it.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2123
 */

// rate-limit marker (#1726): callers pass in a `$` already wrapped by wrapDollarWithGhRetry.
import { wrapDollarWithGhRetry as _wrapDollarWithGhRetry } from './github-rate-limit.lib.mjs';

const noopLog = async () => {};

/**
 * Fetch the draft/open state of a pull request.
 *
 * @param {Object} options
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {number|string} options.prNumber - Pull request number
 * @param {Function} options.$ - command-stream style tagged template executor
 * @param {Function} [options.log] - Logger
 * @returns {Promise<{ok: boolean, isDraft: (boolean|null), state: (string|null), merged: boolean, error: (string|null)}>}
 */
export const getPullRequestDraftState = async ({ owner, repo, prNumber, $, log = noopLog }) => {
  try {
    const result = await $`gh pr view ${prNumber} --repo ${owner}/${repo} --json isDraft,state`;
    if (result.code !== 0) {
      const stderr = result.stderr ? result.stderr.toString().trim() : '';
      return { ok: false, isDraft: null, state: null, merged: false, error: stderr || `gh exited with code ${result.code}` };
    }

    const raw = result.stdout.toString().trim();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, isDraft: null, state: null, merged: false, error: `Could not parse gh output: ${raw.slice(0, 200)}` };
    }

    const state = typeof parsed.state === 'string' ? parsed.state.toUpperCase() : null;
    await log(`   🔍 PR #${prNumber} draft state: isDraft=${parsed.isDraft}, state=${state}`, { verbose: true });

    return { ok: true, isDraft: parsed.isDraft === true, state, merged: state === 'MERGED', error: null };
  } catch (error) {
    return { ok: false, isDraft: null, state: null, merged: false, error: error.message };
  }
};

/**
 * Internal helper shared by ensurePullRequestIsDraft/ensurePullRequestIsReady.
 *
 * @param {Object} options
 * @param {'draft'|'ready'} options.target - Desired state
 * @returns {Promise<{ok: boolean, changed: boolean, skipped: boolean, reason: (string|null), error: (string|null)}>}
 */
const setPullRequestDraftState = async ({ target, owner, repo, prNumber, $, log = noopLog, formatAligned = null, indent = 2, reason = null, reportError = null }) => {
  const wantDraft = target === 'draft';
  const label = wantDraft ? 'draft mode' : 'ready for review';
  const write = async (icon, key, value) => {
    await log(formatAligned ? formatAligned(icon, key, value, indent) : `${icon} ${key} ${value}`);
  };

  if (!owner || !repo || !prNumber) {
    return { ok: false, changed: false, skipped: true, reason: 'missing_pr_context', error: null };
  }

  try {
    const status = await getPullRequestDraftState({ owner, repo, prNumber, $, log });

    if (!status.ok) {
      await log(`Warning: Could not check PR #${prNumber} draft status: ${status.error}`, { level: 'warning' });
      return { ok: false, changed: false, skipped: false, reason: 'status_check_failed', error: status.error };
    }

    // A merged or closed pull request cannot change its draft state; GitHub rejects it.
    if (status.state && status.state !== 'OPEN') {
      await write('ℹ️', 'PR status:', `${status.state.toLowerCase()} - skipping ${label} conversion`);
      return { ok: true, changed: false, skipped: true, reason: `pr_${status.state.toLowerCase()}`, error: null };
    }

    if (status.isDraft === wantDraft) {
      await write('✅', 'PR status:', `Already in ${label}`);
      return { ok: true, changed: false, skipped: true, reason: 'already_in_target_state', error: null };
    }

    await write('📝', 'Converting PR:', `To ${label}${reason ? ` (${reason})` : ''}...`);
    const convertResult = wantDraft ? await $`gh pr ready ${prNumber} --repo ${owner}/${repo} --undo` : await $`gh pr ready ${prNumber} --repo ${owner}/${repo}`;

    if (convertResult.code === 0) {
      await write('✅', 'PR converted:', `Now in ${label}`);
      return { ok: true, changed: true, skipped: false, reason: null, error: null };
    }

    const stderr = convertResult.stderr ? convertResult.stderr.toString().trim() : '';
    await log(`Warning: Could not convert PR #${prNumber} to ${label}${stderr ? `: ${stderr}` : ''}`, { level: 'warning' });
    return { ok: false, changed: false, skipped: false, reason: 'conversion_failed', error: stderr || `gh exited with code ${convertResult.code}` };
  } catch (error) {
    if (typeof reportError === 'function') {
      reportError(error, {
        context: wantDraft ? 'convert_pr_to_draft' : 'convert_pr_to_ready',
        prNumber,
        owner,
        repo,
        operation: 'pr_status_change',
      });
    }
    await log(`Warning: Could not check/convert PR #${prNumber} draft status: ${error.message}`, { level: 'warning' });
    return { ok: false, changed: false, skipped: false, reason: 'exception', error: error.message };
  }
};

/**
 * Put a pull request into draft mode when a working session starts/restarts/resumes.
 * No-op when the PR is already a draft, merged, or closed.
 */
export const ensurePullRequestIsDraft = async options => setPullRequestDraftState({ ...options, target: 'draft' });

/**
 * Put a pull request back to "ready for review" when a working session ends.
 * No-op when the PR is already ready, merged, or closed.
 */
export const ensurePullRequestIsReady = async options => setPullRequestDraftState({ ...options, target: 'ready' });

export default {
  getPullRequestDraftState,
  ensurePullRequestIsDraft,
  ensurePullRequestIsReady,
};
