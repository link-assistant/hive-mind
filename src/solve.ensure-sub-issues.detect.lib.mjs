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
import { isRepositoryModeIssueBody, parseRequiredClosingReferences } from './solve.repository-mode.lib.mjs';

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

/**
 * Combine the native sub-issues with the issue numbers the parent issue body
 * requires to be closed (see `parseRequiredClosingReferences`).
 *
 * Issue #2306: six of the seven issues of a repository-mode run could not be
 * attached as sub-issues ("Sub issue may only have one parent"), so a check
 * based on native sub-issues alone saw a single issue and let a pull request
 * that closed none of the seven be merged. The body lists all of them.
 *
 * @param {object} params
 * @param {Array<object>} params.subIssues - native sub-issues (raw or normalized)
 * @param {number[]} [params.requiredNumbers] - issue numbers from the parent issue body
 * @param {string} [params.owner] - repository of the parent issue
 * @param {string} [params.repo]
 * @returns {Array<{number: number, title: string, owner: string|null, repo: string|null, url: string, source: 'sub-issue'|'issue-body'}>}
 */
export function mergeRequiredSubIssues({ subIssues, requiredNumbers = [], owner = null, repo = null }) {
  const merged = (Array.isArray(subIssues) ? subIssues : []).map(entry => normalizeSubIssueEntry(entry, { owner, repo })).filter(Boolean);
  const result = merged.map(entry => ({ ...entry, source: 'sub-issue' }));
  const sameRepository = entry => (entry.owner || owner) === owner && (entry.repo || repo) === repo;

  for (const raw of Array.isArray(requiredNumbers) ? requiredNumbers : []) {
    const number = Number(raw);
    if (!Number.isInteger(number) || number <= 0) continue;
    if (result.some(entry => entry.number === number && sameRepository(entry))) continue;
    result.push({ number, title: '', owner, repo, url: owner && repo ? `https://github.com/${owner}/${repo}/issues/${number}` : '', source: 'issue-body' });
  }

  return result;
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

/** Merge blocker reason used when the pull request does not close every required issue. */
export const MISSING_CLOSING_REFERENCES_REASON = 'missing_closing_references';

/**
 * Build the `--auto-merge` blocker for a pull request whose description does
 * not close every required issue (issue #2306).
 *
 * Merging such a pull request closes only part of the issues it was asked to
 * close — in the reported run it closed 1 of 8 — so `--auto-merge` holds the
 * merge back and says exactly which references are missing.
 *
 * @param {object} params
 * @param {Array<object>} params.missing
 * @param {number} params.total
 * @param {string|number} [params.prNumber]
 * @param {string|number} [params.issueNumber] - parent issue
 * @param {string} [params.owner]
 * @param {string} [params.repo]
 * @returns {{reason: string, message: string, details: string[], resolution: string}|null} null when nothing is missing
 */
export function buildMissingClosingReferencesBlocker({ missing, total, prNumber = null, issueNumber = null, owner = null, repo = null }) {
  const missingList = Array.isArray(missing) ? missing : [];
  if (missingList.length === 0) return null;

  const details = missingList.slice(0, 20).map(subIssue => `${formatSubIssueReference(subIssue, owner, repo)}${subIssue.title ? ` — ${subIssue.title}` : ''}`);
  if (missingList.length > 20) details.push(`… and ${missingList.length - 20} more`);

  return {
    reason: MISSING_CLOSING_REFERENCES_REASON,
    message: `The pull request${prNumber ? ` #${prNumber}` : ''} description does not close ${missingList.length} of the ${total} issue(s)${issueNumber ? ` required by #${issueNumber}` : ''}`,
    details,
    resolution: `Add these lines to the pull request description, one keyword per issue: ${missingList.map(subIssue => `\`Fixes ${formatSubIssueReference(subIssue, owner, repo)}\``).join(', ')}`,
  };
}

/**
 * Decide whether `--auto-merge` must hold a pull request back because its
 * description does not close every required issue (issue #2306).
 *
 * The gate applies when `--ensure-all-sub-issues-addressed` is enabled, or when
 * the issue was generated by `/solve <repository-url>` (so a later
 * `/solve <pull-request-url> --auto-merge` run is guarded too). Required issues
 * are the native sub-issues plus the closing references listed in the issue body.
 *
 * @param {object} params
 * @param {boolean} params.ensureEnabled - `--ensure-all-sub-issues-addressed` is on
 * @param {string} params.issueBody
 * @param {Array<object>} params.subIssues
 * @param {string} params.prText - pull request title and description
 * @param {string} [params.owner]
 * @param {string} [params.repo]
 * @param {string|number} [params.issueNumber]
 * @param {string|number} [params.prNumber]
 * @returns {{enabled: boolean, total: number, missing: Array<object>, blocker: object|null}}
 */
export function evaluateClosingReferencesGate({ ensureEnabled, issueBody, subIssues, prText, owner = null, repo = null, issueNumber = null, prNumber = null }) {
  const enabled = Boolean(ensureEnabled) || isRepositoryModeIssueBody(issueBody);
  if (!enabled) return { enabled: false, total: 0, missing: [], blocker: null };

  const required = mergeRequiredSubIssues({ subIssues, requiredNumbers: parseRequiredClosingReferences(issueBody), owner, repo });
  const { missing, total } = findMissingSubIssueReferences({ text: prText, subIssues: required, owner, repo });
  return { enabled: true, total, missing, blocker: buildMissingClosingReferencesBlocker({ missing, total, prNumber, issueNumber, owner, repo }) };
}

export default {
  DEFAULT_ENSURE_SUB_ISSUES_LIMIT,
  MISSING_CLOSING_REFERENCES_REASON,
  evaluateClosingReferencesGate,
  mergeRequiredSubIssues,
  buildMissingClosingReferencesBlocker,
  ENSURE_SUB_ISSUES_PROMPT,
  normalizeEnsureSubIssuesLimit,
  formatEnsureSubIssuesLimit,
  normalizeSubIssueEntry,
  findMissingSubIssueReferences,
  buildMissingReferenceBlock,
  buildEnsureSubIssuesFeedback,
};
