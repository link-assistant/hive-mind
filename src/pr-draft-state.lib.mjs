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
 * Issue #2247: a session that produced no diff at all has nothing to review, so
 * converting its pull request to "ready for review" publishes a claim ("solution
 * draft verified") that the diff contradicts. {@link ensurePullRequestIsReady}
 * therefore accepts `requireChanges`, and an empty measured diff records a
 * *deliberate* draft. Issue #2263 applies the same invariant to terminal failures:
 * a clean worktree after a recovery commit is not evidence that verification
 * succeeded. Deliberate drafts are removed from the outstanding registry, so
 * `endWorkSession()` and the interrupt/fatal-error safety nets cannot undo them;
 * the next working session clears the previous verdict and may try again. An
 * unmeasured diff (`measured: false` — gh failed) is never treated as empty.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2123
 * @see https://github.com/link-assistant/hive-mind/issues/2182
 * @see https://github.com/link-assistant/hive-mind/issues/2247
 * Issue #2295: a pull request that a *maintainer* converted to draft is the
 * maintainer's decision, not a working-session draft. {@link ensurePullRequestIsDraft}
 * records it as a deliberate `maintainer_draft`, so neither the session end nor the
 * AI tool's own `gh pr ready` can flip it back to "ready for review".
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2263
 * @see https://github.com/link-assistant/hive-mind/issues/2295
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
 * Issues #2247/#2263: pull requests this process is leaving in draft on purpose,
 * because the session produced an empty diff or ended in failure.
 *
 * Separate from {@link outstandingWorkingSessionDrafts} because the two mean opposite
 * things: an outstanding draft is an obligation to convert, a deliberate draft is a
 * decision not to. Keeping the decision in the same module as the transition is what
 * makes it survive the later `endWorkSession()` call, which knows nothing about diffs.
 *
 * @type {Map<string, {owner: string, repo: string, prNumber: (number|string), reason: (string|null), kind: string, changeStats: (Object|null), since: string}>}
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
 * Pull requests currently held in draft by this process on behalf of a working session.
 * @returns {Array<{owner: string, repo: string, prNumber: (number|string), reason: (string|null), since: string}>}
 */
export const getOutstandingWorkingSessionDrafts = () => Array.from(outstandingWorkingSessionDrafts.values());

/** Forget every tracked draft (used by tests and by a clean process restart). */
export const resetWorkingSessionDrafts = () => {
  outstandingWorkingSessionDrafts.clear();
  deliberateDrafts.clear();
};

/**
 * Issue #2247: record that this process is leaving `prNumber` in draft on purpose.
 * Drops it from the outstanding registry, so the safety nets do not "restore" it.
 */
export const markPullRequestLeftInDraft = ({ owner, repo, prNumber, reason = null, kind = 'deliberate', changeStats = null }) => {
  untrackWorkingSessionDraft({ owner, repo, prNumber });
  deliberateDrafts.set(draftKey(owner, repo, prNumber), { owner, repo, prNumber, reason, kind, changeStats, since: new Date().toISOString() });
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
  const pending = getOutstandingWorkingSessionDrafts();
  if (pending.length === 0) {
    return [];
  }

  await log(`🩹 Restoring ${pending.length} pull request(s) left in draft by this working session...`);
  const results = [];
  for (const entry of pending) {
    results.push(await ensurePullRequestIsReady({ owner: entry.owner, repo: entry.repo, prNumber: entry.prNumber, $, log, formatAligned, reason, reportError }));
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
 * Restore draft mode after a failed/unverified solution and make that decision
 * dominate every later session-end, interrupt, and auto-merge ready safeguard.
 *
 * The deliberate record is written even when GitHub's conversion call fails:
 * retrying `ready` later would make the state less safe, never more safe.
 */
export const ensurePullRequestStaysDraftAfterFailure = async options => {
  const result = await setPullRequestDraftState({ ...options, target: 'draft' });
  markPullRequestLeftInDraft({
    owner: options?.owner,
    repo: options?.repo,
    prNumber: options?.prNumber,
    reason: options?.reason || 'the solution session failed or verification did not succeed',
    kind: 'failure',
  });
  return result;
};

/**
 * Issue #2295: who put an already-draft pull request into draft?
 *
 * Returns the latest `convert_to_draft` timeline event when it is the latest
 * draft/ready transition and was made by someone other than the authenticated
 * gh user (i.e. not by hive-mind or its AI tool). Returns null on any error, so
 * a failed lookup never blocks a session.
 *
 * @returns {Promise<{actor: string, createdAt: string}|null>}
 */
export const findMaintainerDraftConversion = async ({ owner, repo, prNumber, $, log = noopLog }) => {
  if (!owner || !repo || !prNumber || typeof $ !== 'function') return null;
  try {
    const jq = '.[] | select(.event == "convert_to_draft" or .event == "ready_for_review") | [.event, (.actor.login // ""), .created_at] | @tsv';
    const timeline = await $`gh api repos/${owner}/${repo}/issues/${prNumber}/timeline --paginate --jq ${jq}`;
    if (!timeline || timeline.code !== 0) return null;
    const transitions = (timeline.stdout || '')
      .toString()
      .split('\n')
      .map(line => line.trim().split('\t'))
      .filter(fields => fields.length === 3 && (fields[0] === 'convert_to_draft' || fields[0] === 'ready_for_review'));
    const last = transitions[transitions.length - 1];
    if (!last || last[0] !== 'convert_to_draft' || !last[1]) return null;

    const user = await $`gh api user --jq .login`;
    const self = user && user.code === 0 ? (user.stdout || '').toString().trim() : '';
    if (!self || self.toLowerCase() === last[1].toLowerCase()) return null;

    await log(`   🔍 PR #${prNumber} was converted to draft by @${last[1]} at ${last[2]} (authenticated as @${self})`, { verbose: true });
    return { actor: last[1], createdAt: last[2] };
  } catch {
    return null;
  }
};

/**
 * Put a pull request into draft mode when a working session starts/restarts/resumes.
 * No-op when the PR is already a draft, merged, or closed.
 *
 * Issue #2295: when the PR already is a draft because a maintainer converted it,
 * the draft is recorded as the maintainer's (`kind: 'maintainer_draft'`), and
 * {@link ensurePullRequestIsReady} will keep it a draft at the end of the session.
 */
export const ensurePullRequestIsDraft = async options => {
  // Issue #2247: a new session invalidates a previous session's "nothing to
  // review" verdict; it is about to try again.
  clearPullRequestLeftInDraft({ owner: options?.owner, repo: options?.repo, prNumber: options?.prNumber });
  const result = await setPullRequestDraftState({ ...options, target: 'draft' });
  if (result.reason !== 'already_in_target_state') return result;

  const conversion = await findMaintainerDraftConversion(options);
  if (!conversion) return result;
  const reason = `@${conversion.actor} converted it to draft at ${conversion.createdAt}; only a maintainer should mark it ready for review`;
  markPullRequestLeftInDraft({ owner: options.owner, repo: options.repo, prNumber: options.prNumber, reason, kind: 'maintainer_draft' });
  await (options.log || noopLog)(`  ℹ️  PR #${options.prNumber} was converted to draft by a maintainer (@${conversion.actor}); it will stay a draft after this session`);
  return { ...result, maintainerDraft: conversion };
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
 * @param {Object} options
 * @param {boolean} [options.requireChanges=false] - issue #2247: refuse to convert a
 *   pull request whose measured diff against base is empty, and record the refusal so
 *   later ready transitions in the same process do not override it.
 * @param {Object} [options.changeStats] - already-measured stats, to avoid a second
 *   `gh pr diff` when the caller has them.
 * @param {Function} [options.getChangeStats] - injection point for tests.
 * @param {boolean} [options.force=false] - convert even if a previous call in this
 *   process decided to leave the pull request in draft.
 * @returns {Promise<{ok: boolean, changed: boolean, skipped: boolean, reason: (string|null), error: (string|null), changeStats: (Object|null)}>}
 */
export const ensurePullRequestIsReady = async ({ requireChanges = false, changeStats = null, getChangeStats = defaultGetChangeStats, force = false, ...options } = {}) => {
  const { owner, repo, prNumber, $, log = noopLog } = options;

  if (!force) {
    const deliberate = getPullRequestLeftInDraft({ owner, repo, prNumber });
    if (deliberate) {
      await log(`  ℹ️  PR #${prNumber} stays a draft: ${deliberate.reason || 'this session produced no changes'}`);
      if (deliberate.kind === 'maintainer_draft') {
        // Issue #2295: the AI tool may have run `gh pr ready` itself (the prompt
        // asks it to); put the maintainer's draft back. Not a session draft.
        await setPullRequestDraftState({ ...options, target: 'draft', reason: 'restoring the maintainer draft' });
        untrackWorkingSessionDraft({ owner, repo, prNumber });
      }
      return { ok: true, changed: false, skipped: true, reason: 'left_in_draft_on_purpose', error: null, changeStats: deliberate.changeStats };
    }
  }

  if (requireChanges) {
    // `measured: false` means the diff could not be read, not that it is empty;
    // treating that as "no changes" would leave real work stuck in draft.
    const stats = changeStats || (await getChangeStats({ owner, repo, prNumber, $, log }));
    if (stats && stats.measured && !stats.hasChanges) {
      const reason = 'no changes were produced by this session';
      markPullRequestLeftInDraft({ owner, repo, prNumber, reason, kind: 'no_changes', changeStats: stats });
      await log(`  ⚠️  PR #${prNumber} keeps its draft status: ${reason}`, { level: 'warning' });
      return { ok: true, changed: false, skipped: true, reason: 'no_changes', error: null, changeStats: stats };
    }
    const result = await setPullRequestDraftState({ ...options, target: 'ready' });
    return { ...result, changeStats: stats || null };
  }

  const result = await setPullRequestDraftState({ ...options, target: 'ready' });
  return { ...result, changeStats: null };
};

export default {
  clearPullRequestLeftInDraft,
  getPullRequestDraftState,
  getPullRequestLeftInDraft,
  getPullRequestsLeftInDraft,
  ensurePullRequestIsDraft,
  ensurePullRequestIsReady,
  ensurePullRequestStaysDraftAfterFailure,
  findMaintainerDraftConversion,
  getOutstandingWorkingSessionDrafts,
  markPullRequestLeftInDraft,
  restorePullRequestsLeftInDraft,
  resetWorkingSessionDrafts,
};
