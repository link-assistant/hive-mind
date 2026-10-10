#!/usr/bin/env node
/**
 * Dependabot PR discovery for the merge queue.
 *
 * `/merge <repo> --dependabot` and `/fix <repo> --update-all-dependencies`
 * (issue #2885) merge open Dependabot version bump pull requests through the
 * same sequential, CI-gated `MergeQueueProcessor` used for `ready` PRs.
 * Dependabot PRs never carry the `ready` label, so they are discovered by
 * author instead.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2885
 */

import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

import { githubLimits } from './config.lib.mjs';
import { ghWithRateLimitRetry } from './github-rate-limit.lib.mjs';

const execRaw = promisify(execCallback);

const defaultExec = (cmd, opts = {}) =>
  ghWithRateLimitRetry(() => execRaw(cmd, { maxBuffer: githubLimits.bufferMaxSize, ...opts }), {
    label: `gh exec (${cmd.split(/\s+/).slice(0, 3).join(' ')})`,
  });

// `gh pr list --author` accepts the `app/<slug>` form for GitHub Apps.
export const DEPENDABOT_AUTHOR = 'app/dependabot';

// gh reports the app as `app/dependabot`; the REST API uses `dependabot[bot]`.
const DEPENDABOT_LOGINS = new Set(['app/dependabot', 'dependabot[bot]', 'dependabot']);

/**
 * @param {Object} pr - PR object as returned by `gh pr list --json author`
 * @returns {boolean} true when the PR was opened by Dependabot
 */
export function isDependabotPullRequest(pr) {
  const login = String(pr?.author?.login || '').toLowerCase();
  return DEPENDABOT_LOGINS.has(login);
}

/**
 * Fetch open, non-draft Dependabot pull requests, oldest first.
 *
 * Errors propagate so callers can report "could not list Dependabot PRs"
 * instead of silently claiming there is nothing to merge.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {boolean} [verbose=false]
 * @param {Object} [deps]
 * @param {Function} [deps.exec] - injectable exec for tests
 * @returns {Promise<Array<Object>>}
 */
export async function fetchDependabotPullRequests(owner, repo, verbose = false, { exec = defaultExec } = {}) {
  const { stdout } = await exec(`gh pr list --repo ${owner}/${repo} --author "${DEPENDABOT_AUTHOR}" --state open --json number,title,url,createdAt,headRefName,author,mergeable,mergeStateStatus,isDraft --limit 100`);
  const prs = JSON.parse(String(stdout || '').trim() || '[]').filter(pr => isDependabotPullRequest(pr) && !pr.isDraft);
  prs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  if (verbose) {
    console.log(`[VERBOSE] /merge: Found ${prs.length} open Dependabot PRs in ${owner}/${repo}`);
  }
  return prs;
}

/**
 * Merge `ready` queue items with Dependabot PRs into one queue, deduplicated
 * by PR number and sorted oldest first. Dependabot items are flagged with
 * `dependabot: true` so the queue can treat their CI failures as resolvable.
 *
 * @param {Array<{pr: Object, issue: Object|null, sortDate: Date}>} readyItems
 * @param {Array<Object>} dependabotPRs
 * @returns {Array<{pr: Object, issue: Object|null, sortDate: Date, dependabot: boolean}>}
 */
export function mergeDependabotItems(readyItems = [], dependabotPRs = []) {
  const byNumber = new Map();
  for (const item of readyItems) {
    byNumber.set(item.pr.number, { ...item, dependabot: item.dependabot === true || isDependabotPullRequest(item.pr) });
  }
  for (const pr of dependabotPRs) {
    const existing = byNumber.get(pr.number);
    if (existing) {
      existing.dependabot = true;
    } else {
      byNumber.set(pr.number, { pr, issue: null, sortDate: new Date(pr.createdAt), dependabot: true });
    }
  }
  return Array.from(byNumber.values()).sort((a, b) => new Date(a.sortDate) - new Date(b.sortDate));
}

export default {
  DEPENDABOT_AUTHOR,
  isDependabotPullRequest,
  fetchDependabotPullRequests,
  mergeDependabotItems,
};
