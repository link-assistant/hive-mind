#!/usr/bin/env node

/**
 * Make `gh pr create` safe to retry.
 *
 * Issue #2168: `gh pr create` aborted a solve run on GitHub's transient
 * GraphQL internal error. The fix is to retry — but a mutation that failed
 * *after* GitHub committed it (a 5xx on the response path, not the request
 * path) would make the retry fail again with
 *
 *   GraphQL: A pull request already exists for konard:issue-4804-203a323f30b1.
 *
 * which is not transient and would abort the run just the same, only one step
 * later. Retrying a write is only correct when the write is idempotent, so
 * this module turns "already exists" into "here is the pull request you were
 * trying to create".
 */

/**
 * Combined text of an error-ish value, mirroring the collector used by the
 * transient classifier.
 */
const errorText = error => {
  if (!error) return '';
  if (typeof error === 'string') return error;
  const parts = [];
  if (typeof error.message === 'string') parts.push(error.message);
  if (error.stderr) parts.push(error.stderr.toString());
  if (error.stdout) parts.push(error.stdout.toString());
  if (error.cause) parts.push(errorText(error.cause));
  return parts.join('\n');
};

/**
 * Detect `gh pr create`'s "a pull request already exists" rejection.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export const isPullRequestAlreadyExistsError = error => {
  const text = errorText(error).toLowerCase();
  if (!text) return false;
  return text.includes('a pull request already exists') || (text.includes('pull request') && text.includes('already exists'));
};

/**
 * Look up the pull request that already exists for `headRef`.
 *
 * `gh pr list --head` matches on the branch name; for a fork the head is
 * `owner:branch`, and GitHub still indexes it under the bare branch name, so
 * the bare name is what we query with.
 *
 * @param {object} params
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string} params.headRef - branch name, with or without an `owner:` prefix.
 * @param {(command: string, options?: object) => Promise<{stdout: string}>} params.execGh - retry-wrapped exec (e.g. `execGhWithRetry`).
 * @param {(msg: string, options?: object) => Promise<void>|void} [params.log]
 * @returns {Promise<string|null>} PR URL, or null when none could be resolved.
 */
export const findExistingPullRequestUrl = async ({ owner, repo, headRef, execGh, log = null }) => {
  const branch = String(headRef || '').includes(':') ? String(headRef).split(':').pop() : String(headRef || '');
  if (!branch) return null;
  try {
    const { stdout } = await execGh(`gh pr list --repo ${owner}/${repo} --head ${branch} --state all --limit 1 --json url,number,state`, {
      label: 'gh pr list (existing PR lookup)',
    });
    const parsed = JSON.parse((stdout || '[]').toString().trim() || '[]');
    const first = Array.isArray(parsed) ? parsed[0] : null;
    if (first?.url) {
      if (log) await Promise.resolve(log(`   Recovered existing PR #${first.number} (${first.state}) for head ${branch}: ${first.url}`));
      return first.url;
    }
  } catch (lookupError) {
    if (log) await Promise.resolve(log(`   Could not look up the existing PR for head ${branch}: ${lookupError.message}`, { level: 'warn' }));
  }
  return null;
};

export default {
  isPullRequestAlreadyExistsError,
  findExistingPullRequestUrl,
};
