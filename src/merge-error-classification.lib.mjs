#!/usr/bin/env node

/**
 * Classification helpers for pull request mergeability and merge failures.
 *
 * Issue #2182: `/solve ... --auto-merge --auto-restart-until-mergeable` kept a
 * single task "processing" for 4d 12h 13m. The pull request had been converted
 * to draft by an auto-restart iteration and never converted back, so:
 *
 *   1. `checkPRMergeable()` asked GitHub only for `mergeable,mergeStateStatus`.
 *      A draft pull request with no other blockers answers
 *      `MERGEABLE` / `CLEAN` — the `case 'DRAFT'` branch that was supposed to
 *      catch this was dead code, because it is only reachable when
 *      `mergeable !== 'MERGEABLE'`. The watch loop therefore declared
 *      "PR IS MERGEABLE!" on every check.
 *   2. `gh pr merge` then failed with
 *      `GraphQL: Pull Request is still a draft (mergePullRequest)`.
 *   3. The failure was logged as "Will continue monitoring..." and retried
 *      every 120 seconds, forever (5384 identical failures in the reported run).
 *
 * These two pure functions are the single place where "is this pull request
 * actually mergeable?" and "is this merge failure worth retrying?" are decided,
 * so every merge call site can share the same answer.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2182
 * @see docs/case-studies/issue-2182/README.md for the full timeline and evidence
 */

/**
 * Merge failure categories.
 *
 * `recoverable` means hive-mind itself can fix the cause and retry (currently
 * only the draft state). `terminal` means retrying the exact same merge cannot
 * succeed without a human or a new AI session, so a watch loop must stop
 * instead of hammering the API.
 */
export const MERGE_ERROR_CATEGORIES = {
  DRAFT: 'draft',
  CONFLICT: 'conflict',
  BLOCKED: 'blocked',
  CLOSED: 'closed',
  PERMISSION: 'permission',
  NOT_MERGEABLE: 'not_mergeable',
  UNKNOWN: 'unknown',
};

/**
 * How many consecutive failed merge attempts a watch loop may make before it
 * gives up and reports the stop. Issue #2182: there was no such ceiling.
 */
export const MAX_CONSECUTIVE_MERGE_FAILURES = 3;

const MERGE_ERROR_PATTERNS = [
  // "GraphQL: Pull Request is still a draft (mergePullRequest)"
  { category: MERGE_ERROR_CATEGORIES.DRAFT, terminal: false, recoverable: true, pattern: /still a draft|is a draft|draft state|convert(ed)? to draft/i, resolution: 'Mark the pull request as ready for review (gh pr ready <number>) before merging.' },
  { category: MERGE_ERROR_CATEGORIES.CLOSED, terminal: true, recoverable: false, pattern: /pull request is closed|already merged|has already been merged|not open/i, resolution: 'The pull request is no longer open — nothing left to merge.' },
  { category: MERGE_ERROR_CATEGORIES.PERMISSION, terminal: true, recoverable: false, pattern: /resource not accessible|must have (admin|write|push)|permission|403|not authorized|forbidden/i, resolution: 'Grant the token merge permission on the repository, or merge manually.' },
  { category: MERGE_ERROR_CATEGORIES.BLOCKED, terminal: true, recoverable: false, pattern: /required status check|approving review|review is required|protected branch|branch protection|changes must be made through a pull request|merge queue/i, resolution: 'Satisfy the branch protection requirements (reviews / required checks) or merge manually.' },
  { category: MERGE_ERROR_CATEGORIES.CONFLICT, terminal: false, recoverable: false, pattern: /merge conflict|not mergeable due to conflicts|conflicts? with the base branch/i, resolution: 'Resolve the merge conflicts with the base branch, then retry.' },
  { category: MERGE_ERROR_CATEGORIES.NOT_MERGEABLE, terminal: false, recoverable: false, pattern: /pull request is not mergeable|is not mergeable|base branch was modified/i, resolution: 'Wait for GitHub to recompute mergeability, or update the branch from the base branch.' },
];

/**
 * Classify a `gh pr merge` failure message.
 *
 * @param {string|null|undefined} errorMessage raw stderr/message from `gh pr merge`
 * @returns {{category: string, terminal: boolean, recoverable: boolean, resolution: string|null}}
 */
export const classifyMergeError = errorMessage => {
  const text = typeof errorMessage === 'string' ? errorMessage : '';
  for (const entry of MERGE_ERROR_PATTERNS) {
    if (entry.pattern.test(text)) {
      return { category: entry.category, terminal: entry.terminal, recoverable: entry.recoverable, resolution: entry.resolution };
    }
  }
  return { category: MERGE_ERROR_CATEGORIES.UNKNOWN, terminal: false, recoverable: false, resolution: null };
};

/**
 * Decide whether a pull request payload describes a mergeable pull request.
 *
 * Expects the parsed output of
 * `gh pr view <n> --json isDraft,mergeable,mergeStateStatus`.
 *
 * Issue #2182: `isDraft` is checked FIRST and independently of
 * `mergeStateStatus`, because GitHub reports `CLEAN`/`MERGEABLE` for a draft
 * pull request that has no other blockers, while `gh pr merge` still refuses it.
 *
 * @param {{isDraft?: boolean, mergeable?: string|null, mergeStateStatus?: string|null}} pr
 * @returns {{mergeable: boolean, isDraft: boolean, mergeableState: string|null, mergeStateStatus: string|null, reason: string|null}}
 */
export const evaluatePullRequestMergeability = (pr = {}) => {
  const isDraft = pr.isDraft === true;
  const mergeableState = pr.mergeable ?? null;
  const mergeStateStatus = pr.mergeStateStatus ?? null;

  if (isDraft) {
    return { mergeable: false, isDraft: true, mergeableState, mergeStateStatus, reason: 'PR is a draft' };
  }

  if (mergeableState === 'MERGEABLE') {
    return { mergeable: true, isDraft: false, mergeableState, mergeStateStatus, reason: null };
  }

  let reason;
  switch (mergeStateStatus) {
    case 'BLOCKED':
      reason = 'PR is blocked (possibly by branch protection rules)';
      break;
    case 'BEHIND':
      reason = 'PR branch is behind the base branch';
      break;
    case 'DIRTY':
      reason = 'PR has merge conflicts';
      break;
    case 'UNSTABLE':
      reason = 'PR has failing required status checks';
      break;
    case 'DRAFT':
      reason = 'PR is a draft';
      break;
    default:
      reason = `Merge state: ${mergeStateStatus || 'unknown'}`;
  }

  return { mergeable: false, isDraft: false, mergeableState, mergeStateStatus, reason };
};

export default {
  MERGE_ERROR_CATEGORIES,
  MAX_CONSECUTIVE_MERGE_FAILURES,
  classifyMergeError,
  evaluatePullRequestMergeability,
};
