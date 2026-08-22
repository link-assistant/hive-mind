#!/usr/bin/env node
/**
 * GitHub merge target helpers for `/merge`.
 *
 * Repository-wide merge queues still use github-merge.lib.mjs. This module
 * handles the narrower targets introduced in issue #2013: a single PR URL, an
 * issue URL with linked PRs, or a GitHub URL found in a replied message.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2013
 */

import { promisify } from 'node:util';
import { exec as execCallback } from 'node:child_process';

import { githubLimits } from './config.lib.mjs';
import { parseGitHubUrl } from './github.lib.mjs';
import { ghWithRateLimitRetry } from './github-rate-limit.lib.mjs';
import { getLinkedPRsFromTimeline } from './github-merge-ready-sync.lib.mjs';

const execRaw = promisify(execCallback);
const exec = (cmd, opts = {}) =>
  ghWithRateLimitRetry(() => execRaw(cmd, { maxBuffer: githubLimits.bufferMaxSize, ...opts }), {
    label: `gh exec (${cmd.split(/\s+/).slice(0, 3).join(' ')})`,
  });

const SUPPORTED_REPOSITORY_TYPES = new Set(['repo', 'issues_list', 'pulls_list']);
const SUPPORTED_TARGET_TYPES = new Set([...SUPPORTED_REPOSITORY_TYPES, 'issue', 'pull']);

function buildIssueUrl(owner, repo, issueNumber) {
  return `https://github.com/${owner}/${repo}/issues/${issueNumber}`;
}

function buildPullUrl(owner, repo, prNumber) {
  return `https://github.com/${owner}/${repo}/pull/${prNumber}`;
}

/**
 * Parse a `/merge` target URL.
 *
 * @param {string} url
 * @returns {{valid: boolean, mode?: 'repository'|'issue'|'pull', owner: string|null, repo: string|null, issueNumber?: number, prNumber?: number, url?: string, error: string|null}}
 */
export function parseMergeTargetUrl(url) {
  const parsed = parseGitHubUrl(url);

  if (!parsed.valid) {
    return { valid: false, owner: null, repo: null, error: parsed.error };
  }

  if (SUPPORTED_REPOSITORY_TYPES.has(parsed.type)) {
    return {
      valid: true,
      mode: 'repository',
      owner: parsed.owner,
      repo: parsed.repo,
      url: `https://github.com/${parsed.owner}/${parsed.repo}`,
      error: null,
    };
  }

  if (parsed.type === 'issue') {
    return {
      valid: true,
      mode: 'issue',
      owner: parsed.owner,
      repo: parsed.repo,
      issueNumber: parsed.number,
      url: buildIssueUrl(parsed.owner, parsed.repo, parsed.number),
      error: null,
    };
  }

  if (parsed.type === 'pull') {
    return {
      valid: true,
      mode: 'pull',
      owner: parsed.owner,
      repo: parsed.repo,
      prNumber: parsed.number,
      url: buildPullUrl(parsed.owner, parsed.repo, parsed.number),
      error: null,
    };
  }

  if (parsed.type === 'user' || parsed.type === 'organization') {
    return {
      valid: false,
      owner: parsed.owner,
      repo: null,
      error: 'URL points to a user/organization. Please provide a repository, issue, or pull request URL.',
    };
  }

  return {
    valid: false,
    owner: parsed.owner || null,
    repo: parsed.repo || null,
    error: `URL type '${parsed.type}' is not supported for /merge. Please provide a repository, issue, or pull request URL.`,
  };
}

function trimCandidateUrl(candidate) {
  return String(candidate || '')
    .trim()
    .replace(/^[<([{'"]+/, '')
    .replace(/[>)\]}'".,;:!?]+$/, '');
}

/**
 * Extract a single `/merge` target URL from arbitrary text, such as a replied
 * `/codex https://github.com/owner/repo/issues/123 --think max` message.
 *
 * @param {string} text
 * @returns {{valid: boolean, url: string|null, target: Object|null, error: string|null}}
 */
export function extractMergeTargetUrlFromText(text) {
  if (!text || typeof text !== 'string') {
    return { valid: false, url: null, target: null, error: 'No text to inspect for GitHub links' };
  }

  const pattern = /(?:https?:\/\/)?github\.com\/[^\s<>)\]]+|[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:issues|pull)\/\d+/g;
  const matches = text.match(pattern) || [];
  const targetsByUrl = new Map();

  for (const match of matches) {
    const candidate = trimCandidateUrl(match);
    const target = parseMergeTargetUrl(candidate);
    if (target.valid && SUPPORTED_TARGET_TYPES.has(target.mode === 'repository' ? 'repo' : target.mode)) {
      targetsByUrl.set(target.url, target);
    }
  }

  const targets = [...targetsByUrl.values()];
  if (targets.length === 0) {
    return { valid: false, url: null, target: null, error: 'No GitHub repository, issue, or pull request link found' };
  }
  if (targets.length > 1) {
    return { valid: false, url: null, target: null, error: `Expected one GitHub merge target, found ${targets.length}` };
  }

  const [target] = targets;
  return { valid: true, url: target.url, target, error: null };
}

/**
 * Fetch a PR in the shape expected by MergeQueueItem.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {number} prNumber
 * @param {Object|null} issue
 * @param {boolean} verbose
 * @returns {Promise<{pr: Object, issue: Object|null, sortDate: Date}>}
 */
export async function fetchMergeTargetPullRequest(owner, repo, prNumber, issue = null, verbose = false) {
  const { stdout } = await exec(`gh pr view ${prNumber} --repo ${owner}/${repo} --json number,title,url,createdAt,headRefName,author,mergeable,mergeStateStatus,isDraft,state`);
  const pr = JSON.parse(stdout.trim());
  if (verbose) {
    console.log(`[VERBOSE] /merge: Loaded target PR #${pr.number} from ${owner}/${repo}`);
  }
  return {
    pr,
    issue,
    sortDate: new Date(pr.createdAt),
  };
}

/**
 * Resolve a non-repository merge target into queue item data.
 *
 * @param {{mode: string, owner: string, repo: string, issueNumber?: number, prNumber?: number, url?: string}} target
 * @param {boolean} verbose
 * @returns {Promise<Array<{pr: Object, issue: Object|null, sortDate: Date}>|null>}
 */
export async function resolveMergeTargetItems(target, verbose = false) {
  if (!target || target.mode === 'repository') {
    return null;
  }

  if (target.mode === 'pull') {
    return [await fetchMergeTargetPullRequest(target.owner, target.repo, target.prNumber, null, verbose)];
  }

  if (target.mode === 'issue') {
    const issue = {
      number: target.issueNumber,
      url: target.url || buildIssueUrl(target.owner, target.repo, target.issueNumber),
    };
    const linkedPRs = await getLinkedPRsFromTimeline(target.owner, target.repo, target.issueNumber, verbose);
    const items = [];
    for (const linkedPR of linkedPRs) {
      items.push(await fetchMergeTargetPullRequest(target.owner, target.repo, linkedPR.number, issue, verbose));
    }
    return items.sort((a, b) => a.sortDate - b.sortDate);
  }

  throw new Error(`Unsupported merge target mode: ${target.mode}`);
}

export default {
  parseMergeTargetUrl,
  extractMergeTargetUrlFromText,
  fetchMergeTargetPullRequest,
  resolveMergeTargetItems,
};
