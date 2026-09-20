#!/usr/bin/env node

/**
 * Pure detection helpers for `--ensure-all-sub-issues-addressed` (issue #2212).
 *
 * The option checks that the pull request description closes every sub-issue of
 * the issue being solved with a reference GitHub actually recognizes. When a
 * reference is missing, solve auto-restarts the AI tool and asks it to double
 * check that every sub-issue was really addressed in this single pull request.
 *
 * GitHub requires the full closing syntax per issue — `Fixes #1, #2` closes only
 * `#1` — which is exactly what `prClosesIssue` implements, so this module reuses
 * it instead of writing a second, subtly different parser.
 *
 * Everything here is network-free so it can be unit tested in isolation. The
 * network side lives in `solve.ensure-sub-issues.lib.mjs`.
 */

import { prClosesIssue } from './github-linking.lib.mjs';
import { normalizeKeepWorkingLimit } from './solve.keep-working.detect.lib.mjs';

/** Default number of auto-restarts when closing references are missing. */
export const DEFAULT_ENSURE_SUB_ISSUES_LIMIT = 5;

/**
 * Reinforcement prompt appended to every restart, in addition to the concrete
 * list of sub-issues whose closing references are missing.
 */
export const ENSURE_SUB_ISSUES_PROMPT = 'Double check that every sub-issue listed above was really addressed in this single pull request, then make sure the pull request description closes each of them with a GitHub recognized closing reference.';

/**
 * Normalize the `--ensure-all-sub-issues-addressed` value into a restart limit.
 *
 * Shares the semantics of `--keep-working-until-all-requirements-are-fully-done`:
 *  - falsy (undefined / null / false / "") -> 0 (disabled)
 *  - bare flag (true) -> DEFAULT_ENSURE_SUB_ISSUES_LIMIT
 *  - "forever" / "unlimited" / "infinite" / 0 / "0" -> Infinity
 *  - positive number / numeric string -> floor(value)
 *
 * @param {*} value
 * @returns {number}
 */
export function normalizeEnsureSubIssuesLimit(value) {
  return normalizeKeepWorkingLimit(value, DEFAULT_ENSURE_SUB_ISSUES_LIMIT);
}

/**
 * Human readable description of the limit for logs.
 * @param {number} limit
 * @returns {string}
 */
export function formatEnsureSubIssuesLimit(limit) {
  return limit === Infinity ? 'unlimited' : `${limit}`;
}

/**
 * Normalize a raw sub-issue entry (REST `sub_issues` payload, or an already
 * normalized entry) into `{number, title, owner, repo, url}`.
 *
 * The owner/repo are derived from `repository_url` when present so cross
 * repository sub-issues are matched with their fully qualified reference.
 *
 * @param {object} entry
 * @param {{owner?: string, repo?: string}} [fallbackRepository]
 * @returns {{number: number, title: string, owner: string|null, repo: string|null, url: string}|null}
 */
export function normalizeSubIssueEntry(entry, fallbackRepository = {}) {
  if (!entry || typeof entry !== 'object') return null;
  const number = Number(entry.number);
  if (!Number.isInteger(number) || number <= 0) return null;

  let owner = entry.owner || fallbackRepository.owner || null;
  let repo = entry.repo || fallbackRepository.repo || null;

  const repositoryUrl = String(entry.repository_url || '');
  const match = repositoryUrl.match(/repos\/([^/]+)\/([^/]+)$/);
  if (match) {
    owner = match[1];
    repo = match[2];
  }

  return {
    number,
    title: String(entry.title || '').trim(),
    owner,
    repo,
    url: String(entry.html_url || entry.url || '').trim(),
  };
}

/**
 * Find the sub-issues whose closing reference is missing from `text`.
 *
 * A sub-issue counts as referenced when the text contains a GitHub recognized
 * closing keyword for it (`closes #12`, `fixes owner/repo#12`,
 * `resolves https://github.com/owner/repo/issues/12`, ...).
 *
 * @param {object} params
 * @param {string} params.text - pull request description (and optionally title)
 * @param {Array<object>} params.subIssues
 * @param {string} [params.owner] - repository of the parent issue
 * @param {string} [params.repo]
 * @returns {{missing: Array<object>, referenced: Array<object>, total: number}}
 */
export function findMissingSubIssueReferences({ text, subIssues, owner = null, repo = null }) {
  const normalized = (Array.isArray(subIssues) ? subIssues : []).map(entry => normalizeSubIssueEntry(entry, { owner, repo })).filter(Boolean);

  const missing = [];
  const referenced = [];

  for (const subIssue of normalized) {
    if (prClosesIssue(text, subIssue.number, subIssue.owner, subIssue.repo)) {
      referenced.push(subIssue);
    } else {
      missing.push(subIssue);
    }
  }

  return { missing, referenced, total: normalized.length };
}

function formatSubIssueReference(subIssue, owner, repo) {
  const crossRepository = subIssue.owner && subIssue.repo && (subIssue.owner !== owner || subIssue.repo !== repo);
  return crossRepository ? `${subIssue.owner}/${subIssue.repo}#${subIssue.number}` : `#${subIssue.number}`;
}

/**
 * Build the closing-reference block the AI is asked to add, one keyword per
 * issue as GitHub requires.
 *
 * @param {Array<object>} subIssues
 * @param {object} [params]
 * @returns {string}
 */
export function buildMissingReferenceBlock(subIssues, { owner = null, repo = null, keyword = 'Fixes' } = {}) {
  return (Array.isArray(subIssues) ? subIssues : []).map(subIssue => `${keyword} ${formatSubIssueReference(subIssue, owner, repo)}`).join('\n');
}

/**
 * Build the feedback lines injected into the restart iteration.
 *
 * @param {object} params
 * @param {Array<object>} params.missing
 * @param {number} params.total
 * @param {number} params.iteration
 * @param {number} params.limit
 * @param {string} [params.owner]
 * @param {string} [params.repo]
 * @param {string|number} [params.issueNumber] - parent issue
 * @returns {string[]}
 */
export function buildEnsureSubIssuesFeedback({ missing, total, iteration, limit, owner = null, repo = null, issueNumber = null }) {
  const missingList = Array.isArray(missing) ? missing : [];
  const lines = ['', '='.repeat(60), '🧩 ENSURE ALL SUB-ISSUES ADDRESSED:', '='.repeat(60), '', `Restart ${iteration}/${formatEnsureSubIssuesLimit(limit)}.`, '', `This issue${issueNumber ? ` (#${issueNumber})` : ''} has ${total} sub-issue(s). The pull request description is missing a GitHub recognized closing reference for ${missingList.length} of them:`, ''];

  for (const subIssue of missingList) {
    const reference = formatSubIssueReference(subIssue, owner, repo);
    lines.push(`  • ${reference}${subIssue.title ? ` — ${subIssue.title}` : ''}${subIssue.url ? ` (${subIssue.url})` : ''}`);
  }

  lines.push('', 'For each sub-issue above:', '  1. Verify it was really addressed by the changes in this pull request. If it was not, implement it now — in this same pull request.', '  2. Then update the pull request description so it closes the sub-issue.', '', 'GitHub only recognizes the full closing syntax repeated per issue: "Fixes #1, #2" closes only #1.', 'Add these lines to the pull request description (keep any existing closing references):', '', buildMissingReferenceBlock(missingList, { owner, repo }), '', ENSURE_SUB_ISSUES_PROMPT, '');

  return lines;
}

export default {
  DEFAULT_ENSURE_SUB_ISSUES_LIMIT,
  ENSURE_SUB_ISSUES_PROMPT,
  normalizeEnsureSubIssuesLimit,
  formatEnsureSubIssuesLimit,
  normalizeSubIssueEntry,
  findMissingSubIssueReferences,
  buildMissingReferenceBlock,
  buildEnsureSubIssuesFeedback,
};
