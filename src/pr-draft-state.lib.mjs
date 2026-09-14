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
 * Issue #2182: the draft transition was code-driven and unconditional while the
 * matching ready transition was delegated to the AI tool (the prompt asks it to run
 * `gh pr ready <n>`) and to `endWorkSession()`, which only runs in continue mode and
 * only after the auto-merge watch loop returns. When the AI simply did not run the
 * command, the pull request stayed a draft forever. This module therefore *tracks*
 * every draft it hands out, so the matching ready transition can be guaranteed by
 * code — including on the interrupt and fatal-error exit paths.
 *
 * Issue #2246: #2182 made "ready for review" the state of a pull request whose AI
 * working session is over — but in the default mode (`--auto-restart-until-mergeable`)
 * the session ending is not the end of the work: hive-mind keeps restarting the AI until
 * every CI/CD check passes. A pull request marked "ready for review" during that window
 * invites a human to merge unfinished work, which is what happened in
 * https://github.com/Time0utXC/digitalstructures.pro/pull/4. The *ready hold* below lets
 * the mergeable-mode caller say "not yet": while it is engaged, every ready transition is
 * turned back into a draft transition, so the AI cannot take the pull request out of
 * draft either. `ignoreReadyHold: true` bypasses the hold and is what the exit paths
 * (mergeable state reached, interrupt, fatal error) use to preserve #2182's invariant.
 * It is deliberately a different option from #2247's `force`: skipping the hold must not
 * also publish a pull request that was left in draft because it has an empty diff.
 *
 * Issue #2247: the ready transition needs one exception, and exactly one. A session
 * that produced no diff at all has nothing to review, so converting its pull request
 * to "ready for review" publishes a claim ("solution draft verified") that the diff
 * contradicts — all three reproduction runs did this, one of them with zero commits.
 * {@link ensurePullRequestIsReady} therefore accepts `requireChanges`, and an empty
 * measured diff records a *deliberate* draft: it is removed from the outstanding
 * registry, so neither `endWorkSession()` nor the interrupt/fatal-error safety nets
 * undo the decision, and the next session start clears it again. An unmeasured diff
 * (`measured: false` — gh failed) is never treated as empty.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2123
 * @see https://github.com/link-assistant/hive-mind/issues/2182
 * @see https://github.com/link-assistant/hive-mind/issues/2246
 * @see https://github.com/link-assistant/hive-mind/issues/2247
 * @see docs/case-studies/issue-2182/README.md for the full timeline and evidence
 */

// rate-limit marker (#1726): callers pass in a `$` already wrapped by wrapDollarWithGhRetry.
import { wrapDollarWithGhRetry as _wrapDollarWithGhRetry } from './github-rate-limit.lib.mjs';

const noopLog = async () => {};

/**
 * Issue #2182: pull requests this process put into draft for a working session that
 * has not been converted back to "ready for review" yet.
 *
 * Keyed by `owner/repo#number`, module-level on purpose: like working-session.lib.mjs
 * this is a per-process singleton, and the safety nets that drain it (interrupt
 * handler, fatal-error handler) have no access to the call site that drafted the PR.
 *
 * @type {Map<string, {owner: string, repo: string, prNumber: (number|string), reason: (string|null), since: string}>}
 */
const outstandingWorkingSessionDrafts = new Map();

/**
 * Issue #2247: pull requests this process is leaving in draft on purpose, because the
 * session that just ended produced an empty diff.
 *
 * Separate from {@link outstandingWorkingSessionDrafts} because the two mean opposite
 * things: an outstanding draft is an obligation to convert, a deliberate draft is a
 * decision not to. Keeping the decision in the same module as the transition is what
 * makes it survive the later `endWorkSession()` call, which knows nothing about diffs.
 *
 * @type {Map<string, {owner: string, repo: string, prNumber: (number|string), reason: (string|null), changeStats: (Object|null), since: string}>}
 */
const deliberateDrafts = new Map();

const draftKey = (owner, repo, prNumber) => `${owner}/${repo}#${prNumber}`;

/**
 * Record that a working session of this process is holding `prNumber` in draft.
 * Also called when the pull request already was a draft: what matters for the
 * invariant is that a session is now responsible for converting it back.
 */
const trackWorkingSessionDraft = ({ owner, repo, prNumber, reason }) => {
  outstandingWorkingSessionDrafts.set(draftKey(owner, repo, prNumber), { owner, repo, prNumber, reason: reason || null, since: new Date().toISOString() });
};

/** Record that `prNumber` is no longer held in draft by this process. */
const untrackWorkingSessionDraft = ({ owner, repo, prNumber }) => {
  outstandingWorkingSessionDrafts.delete(draftKey(owner, repo, prNumber));
};

/**
 * Issue #2246: while hive-mind is still responsible for making the pull request
 * mergeable, "ready for review" is a lie. A single hold (this process works on one
 * pull request at a time, like outstandingWorkingSessionDrafts above) suppresses every
 * non-forced ready transition and re-asserts draft instead.
 *
 * @type {{reason: (string|null), since: string}|null}
 */
let readyForReviewHold = null;

/**
 * Suppress "ready for review" transitions until the ready-to-merge state is reached.
 * @param {Object} [options]
 * @param {string} [options.reason] - Why the hold is engaged (logged and reported)
 * @returns {{reason: (string|null), since: string}}
 */
export const holdReadyForReview = ({ reason = null } = {}) => {
  readyForReviewHold = { reason, since: new Date().toISOString() };
  return readyForReviewHold;
};

/** Release the hold, so the next ready transition goes through. Returns the released hold. */
export const releaseReadyForReviewHold = () => {
  const released = readyForReviewHold;
  readyForReviewHold = null;
  return released;
};

/** Is the "ready for review" transition currently held back? */
export const isReadyForReviewHeld = () => readyForReviewHold !== null;

/** The active hold (reason + timestamp), or null. */
export const getReadyForReviewHold = () => readyForReviewHold;

/**
 * Pull requests currently held in draft by this process on behalf of a working session.
 * @returns {Array<{owner: string, repo: string, prNumber: (number|string), reason: (string|null), since: string}>}
 */
export const getOutstandingWorkingSessionDrafts = () => Array.from(outstandingWorkingSessionDrafts.values());

/** Forget every tracked draft (used by tests and by a clean process restart). */
export const resetWorkingSessionDrafts = () => {
  outstandingWorkingSessionDrafts.clear();
  readyForReviewHold = null;
  deliberateDrafts.clear();
};

/**
 * Issue #2247: record that this process is leaving `prNumber` in draft on purpose.
 * Drops it from the outstanding registry, so the safety nets do not "restore" it.
 */
export const markPullRequestLeftInDraft = ({ owner, repo, prNumber, reason = null, changeStats = null }) => {
  untrackWorkingSessionDraft({ owner, repo, prNumber });
  deliberateDrafts.set(draftKey(owner, repo, prNumber), { owner, repo, prNumber, reason, changeStats, since: new Date().toISOString() });
};

/** The deliberate-draft record for a pull request, or null. */
export const getPullRequestLeftInDraft = ({ owner, repo, prNumber }) => deliberateDrafts.get(draftKey(owner, repo, prNumber)) || null;

/** Every pull request this process is leaving in draft on purpose. */
export const getPullRequestsLeftInDraft = () => Array.from(deliberateDrafts.values());

/**
 * Forget the decision for one pull request. A new working session clears it: the
 * next session may well produce the diff the previous one did not.
 */
export const clearPullRequestLeftInDraft = ({ owner, repo, prNumber }) => {
  deliberateDrafts.delete(draftKey(owner, repo, prNumber));
};

/**
 * Issue #2182 safety net: convert back to "ready for review" every pull request this
 * process left in draft for a working session that is now over.
 *
 * Called from the interrupt handler and the fatal-error handler, so an aborted session
 * cannot leave a pull request permanently unmergeable. A no-op when nothing is
 * outstanding, so it is safe to call on every exit path.
 *
 * @param {Object} options
 * @param {Function} options.$ - command-stream style tagged template executor
 * @param {Function} [options.log]
 * @param {Function} [options.formatAligned]
 * @param {string} [options.reason]
 * @param {Function} [options.reportError]
 * @returns {Promise<Array<Object>>} one result per restored pull request
 */
export const restorePullRequestsLeftInDraft = async ({ $, log = noopLog, formatAligned = null, reason = 'working session ended', reportError = null } = {}) => {
  // Issue #2246: this is an exit path — whatever the hold was waiting for is not going
  // to happen anymore, so release it before restoring, and force the transition through.
  const released = releaseReadyForReviewHold();
  const pending = getOutstandingWorkingSessionDrafts();
  if (pending.length === 0) {
    return [];
  }
  if (released) {
    await log(`🔓 Releasing the "ready for review" hold (${released.reason || 'no reason recorded'}) before restoring pull request state...`);
  }

  await log(`🩹 Restoring ${pending.length} pull request(s) left in draft by this working session...`);
  const results = [];
  for (const entry of pending) {
    results.push(await ensurePullRequestIsReady({ owner: entry.owner, repo: entry.repo, prNumber: entry.prNumber, $, log, formatAligned, reason, reportError, ignoreReadyHold: true }));
  }
  return results;
};

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
const setPullRequestDraftState = async ({ target, owner, repo, prNumber, $, log = noopLog, formatAligned = null, indent = 2, reason = null, reportError = null, ignoreReadyHold = false }) => {
  // Issue #2246: while the hold is engaged the pull request must stay a draft, because
  // hive-mind has not finished making it mergeable yet. A ready transition therefore
  // becomes a draft transition: this covers both hive-mind's own end-of-session call and
  // an AI worker that ran `gh pr ready` against the prompt's instructions.
  if (target === 'ready' && !ignoreReadyHold && isReadyForReviewHeld()) {
    const held = getReadyForReviewHold();
    await log(formatAligned ? formatAligned('⏸️', 'PR stays draft:', `${held.reason || 'ready-to-merge state not reached yet'}${reason ? ` (requested by: ${reason})` : ''}`, indent) : `⏸️ PR stays draft: ${held.reason || 'ready-to-merge state not reached yet'}`);
    const reassert = await setPullRequestDraftState({ target: 'draft', owner, repo, prNumber, $, log, formatAligned, indent, reason: `ready for review held back: ${held.reason || 'ready-to-merge state not reached yet'}`, reportError });
    return { ok: reassert.ok, changed: reassert.changed, skipped: true, reason: 'ready_hold_active', error: reassert.error };
  }

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
      // A merged/closed PR can no longer block anything, so stop tracking it (#2182).
      untrackWorkingSessionDraft({ owner, repo, prNumber });
      await write('ℹ️', 'PR status:', `${status.state.toLowerCase()} - skipping ${label} conversion`);
      return { ok: true, changed: false, skipped: true, reason: `pr_${status.state.toLowerCase()}`, error: null };
    }

    if (status.isDraft === wantDraft) {
      // Issue #2182: even when the PR already is a draft, this session now owns the
      // obligation to convert it back, so it must be tracked like any other draft.
      if (wantDraft) {
        trackWorkingSessionDraft({ owner, repo, prNumber, reason });
      } else {
        untrackWorkingSessionDraft({ owner, repo, prNumber });
      }
      await write('✅', 'PR status:', `Already in ${label}`);
      return { ok: true, changed: false, skipped: true, reason: 'already_in_target_state', error: null };
    }

    await write('📝', 'Converting PR:', `To ${label}${reason ? ` (${reason})` : ''}...`);
    const convertResult = wantDraft ? await $`gh pr ready ${prNumber} --repo ${owner}/${repo} --undo` : await $`gh pr ready ${prNumber} --repo ${owner}/${repo}`;

    if (convertResult.code === 0) {
      if (wantDraft) {
        trackWorkingSessionDraft({ owner, repo, prNumber, reason });
      } else {
        untrackWorkingSessionDraft({ owner, repo, prNumber });
      }
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
export const ensurePullRequestIsDraft = async options => {
  // Issue #2247: a new session invalidates a previous session's "nothing to
  // review" verdict; it is about to try again.
  clearPullRequestLeftInDraft({ owner: options?.owner, repo: options?.repo, prNumber: options?.prNumber });
  return setPullRequestDraftState({ ...options, target: 'draft' });
};

/** Default source of truth for "did this pull request change anything?". */
const defaultGetChangeStats = async ({ owner, repo, prNumber, $, log }) => {
  const { getPullRequestChangeStats } = await import('./pull-request-changes.lib.mjs');
  return getPullRequestChangeStats({ owner, repo, prNumber, $, log });
};

/**
 * Put a pull request back to "ready for review" when a working session ends.
 * No-op when the PR is already ready, merged, or closed.
 *
 * Issue #2246: suppressed (and the draft re-asserted) while the ready hold is engaged,
 * unless the caller passes `ignoreReadyHold: true`.
 *
 * @param {Object} options
 * @param {boolean} [options.requireChanges=false] - issue #2247: refuse to convert a
 *   pull request whose measured diff against base is empty, and record the refusal so
 *   later ready transitions in the same process do not override it.
 * @param {Object} [options.changeStats] - already-measured stats, to avoid a second
 *   `gh pr diff` when the caller has them.
 * @param {Function} [options.getChangeStats] - injection point for tests.
 * @param {boolean} [options.force=false] - convert even if a previous call in this
 *   process decided to leave the pull request in draft (#2247).
 * @param {boolean} [options.ignoreReadyHold=false] - issue #2246: convert even while the
 *   ready hold is engaged. Used by the exit paths, which is what preserves #2182's
 *   invariant; it does not override an empty-diff draft (#2247).
 * @returns {Promise<{ok: boolean, changed: boolean, skipped: boolean, reason: (string|null), error: (string|null), changeStats: (Object|null)}>}
 */
export const ensurePullRequestIsReady = async ({ requireChanges = false, changeStats = null, getChangeStats = defaultGetChangeStats, force = false, ignoreReadyHold = false, ...options } = {}) => {
  const { owner, repo, prNumber, $, log = noopLog } = options;

  if (!force) {
    const deliberate = getPullRequestLeftInDraft({ owner, repo, prNumber });
    if (deliberate) {
      await log(`  ℹ️  PR #${prNumber} stays a draft: ${deliberate.reason || 'this session produced no changes'}`);
      return { ok: true, changed: false, skipped: true, reason: 'left_in_draft_on_purpose', error: null, changeStats: deliberate.changeStats };
    }
  }

  if (requireChanges) {
    // `measured: false` means the diff could not be read, not that it is empty;
    // treating that as "no changes" would leave real work stuck in draft.
    const stats = changeStats || (await getChangeStats({ owner, repo, prNumber, $, log }));
    if (stats && stats.measured && !stats.hasChanges) {
      const reason = 'no changes were produced by this session';
      markPullRequestLeftInDraft({ owner, repo, prNumber, reason, changeStats: stats });
      await log(`  ⚠️  PR #${prNumber} keeps its draft status: ${reason}`, { level: 'warning' });
      return { ok: true, changed: false, skipped: true, reason: 'no_changes', error: null, changeStats: stats };
    }
    const result = await setPullRequestDraftState({ ...options, target: 'ready', ignoreReadyHold });
    return { ...result, changeStats: stats || null };
  }

  const result = await setPullRequestDraftState({ ...options, target: 'ready', ignoreReadyHold });
  return { ...result, changeStats: null };
};

export default {
  clearPullRequestLeftInDraft,
  getPullRequestDraftState,
  holdReadyForReview,
  releaseReadyForReviewHold,
  isReadyForReviewHeld,
  getReadyForReviewHold,
  getPullRequestLeftInDraft,
  getPullRequestsLeftInDraft,
  ensurePullRequestIsDraft,
  ensurePullRequestIsReady,
  getOutstandingWorkingSessionDrafts,
  markPullRequestLeftInDraft,
  restorePullRequestsLeftInDraft,
  resetWorkingSessionDrafts,
};
