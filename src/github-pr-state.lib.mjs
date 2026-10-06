import { execGhWithRetry } from './github-rate-limit.lib.mjs';

/**
 * Resolve the externally visible state of a GitHub pull request.
 *
 * A strict URL parser keeps the command limited to GitHub owner/repo/PR
 * identifiers. The REST response exposes `merged` and `merged_at`, which are
 * stronger evidence of goal completion than the detached runner's exit code.
 *
 * @param {string|null} pullRequestUrl
 * @param {Object} [options]
 * @param {Function} [options.lookupPullRequestState] - Test/application override
 * @param {boolean} [options.verbose]
 * @returns {Promise<{merged:boolean, mergedAt:string|null, state:string|null}|null>}
 */
export async function resolvePullRequestState(pullRequestUrl, { lookupPullRequestState = null, verbose = false } = {}) {
  if (!pullRequestUrl) return null;
  if (typeof lookupPullRequestState === 'function') {
    return (await lookupPullRequestState(pullRequestUrl)) || null;
  }

  const match = String(pullRequestUrl).match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?:[/?#].*)?$/i);
  if (!match) {
    if (verbose) console.log(`[VERBOSE] Cannot resolve PR state for unrecognized URL: ${pullRequestUrl}`);
    return null;
  }

  const [, owner, repo, number] = match;
  try {
    const { stdout } = await execGhWithRetry(`gh api repos/${owner}/${repo}/pulls/${number} --jq '{merged: .merged, mergedAt: .merged_at, state: .state}'`, {
      execOptions: {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      },
      label: `gh api pull request state (${owner}/${repo}#${number})`,
    });
    const state = JSON.parse(stdout);
    return {
      merged: state?.merged === true,
      mergedAt: state?.mergedAt || null,
      state: state?.state || null,
    };
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] Pull request state lookup failed for ${pullRequestUrl}: ${error?.message || error}`);
    return null;
  }
}

export async function resolveFailedSessionPullRequestState({ pullRequestUrl, outcome, killEvidence = false, lookupPullRequestState = null, verbose = false, sessionName = 'unknown', exitCode = null, status = null, logPath = null } = {}) {
  // Issue #2498: a killed session, or a successful one that saw a container OOM
  // event, is checked too — once its pull request is merged the work is done,
  // so nothing may be recovered or reported as a recovery after the merge.
  if (!pullRequestUrl || !(outcome?.failed || outcome?.killed || killEvidence)) return null;
  const state = await resolvePullRequestState(pullRequestUrl, { lookupPullRequestState, verbose });
  if (verbose && state) {
    console.log(`[VERBOSE] Completion evidence for ${sessionName}: exitCode=${exitCode}, status=${status || 'unknown'}, pullRequest=${pullRequestUrl}, merged=${state.merged}, mergedAt=${state.mergedAt || 'unknown'}, logPath=${logPath || 'unknown'}`);
  }
  return state;
}
