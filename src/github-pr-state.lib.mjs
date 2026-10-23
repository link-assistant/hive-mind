import { execGhWithRetry } from './github-rate-limit.lib.mjs';
import { isSessionStartComment } from './description-edits.lib.mjs';
import { READY_TO_MERGE_MARKER } from './tool-comments.lib.mjs';

/** Issue #2809: the heading solve posts once the pull request is ready (solve.auto-merge.lib.mjs). */
export const READY_TO_MERGE_HEADING = `## ✅ ${READY_TO_MERGE_MARKER}`;
// Markers sit at the start of a tool comment; the rest (an inlined log) is not needed.
const COMMENT_HEAD_CHARS = 2000;
const PULL_REQUEST_URL_PATTERN = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)(?:[/?#].*)?$/i;

/**
 * Issue #2809: whether the newest "## ✅ Ready to merge" comment is newer than
 * the newest session-start comment, i.e. the last session finished its work.
 *
 * @param {string[]} bodies - Comment bodies, oldest first
 * @returns {boolean}
 */
export function isReadyToMergeCommentLatest(bodies) {
  let ready = false;
  for (const body of Array.isArray(bodies) ? bodies : []) {
    const text = String(body || '').trimStart();
    if (text.startsWith(READY_TO_MERGE_HEADING)) ready = true;
    else if (isSessionStartComment(text)) ready = false;
  }
  return ready;
}

/**
 * The heads of all conversation comments of a pull request, oldest first.
 *
 * @returns {Promise<string[]|null>} null when the lookup failed
 */
export async function lookupPullRequestCommentBodies(pullRequestUrl, { verbose = false } = {}) {
  const match = PULL_REQUEST_URL_PATTERN.exec(String(pullRequestUrl || ''));
  if (!match) return null;
  const [, owner, repo, number] = match;
  try {
    const { stdout } = await execGhWithRetry(`gh api repos/${owner}/${repo}/issues/${number}/comments --paginate --jq '.[] | (.body // "") | .[0:${COMMENT_HEAD_CHARS}] | @json'`, {
      execOptions: { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      label: `gh api pull request comments (${owner}/${repo}#${number})`,
    });
    return String(stdout || '')
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] Pull request comment lookup failed for ${pullRequestUrl}: ${error?.message || error}`);
    return null;
  }
}

/**
 * Issue #2809: whether the pull request already says "Ready to merge" for the
 * latest session.
 *
 * @param {string} pullRequestUrl
 * @param {Object} [options]
 * @param {Function} [options.lookupCommentBodies] - Test/application override: url => string[]|null
 * @returns {Promise<boolean|null>} null when unknown
 */
export async function resolveReadyToMerge(pullRequestUrl, { lookupCommentBodies = null, verbose = false } = {}) {
  // An issue is never ready to merge; only pull request comments are read.
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.test(String(pullRequestUrl || ''))) return false;
  const lookup = typeof lookupCommentBodies === 'function' ? lookupCommentBodies : lookupPullRequestCommentBodies;
  try {
    const bodies = await lookup(pullRequestUrl, { verbose });
    return Array.isArray(bodies) ? isReadyToMergeCommentLatest(bodies) : null;
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] Ready-to-merge check failed for ${pullRequestUrl}: ${error?.message || error}`);
    return null;
  }
}

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
 * @param {Function} [options.lookupCommentBodies] - Issue #2809: override for the "Ready to merge" check
 * @param {boolean} [options.verbose]
 * @returns {Promise<{merged:boolean, mergedAt:string|null, state:string|null, readyToMerge?:boolean|null}|null>}
 */
export async function resolvePullRequestState(pullRequestUrl, { lookupPullRequestState = null, lookupCommentBodies = null, verbose = false } = {}) {
  if (!pullRequestUrl) return null;
  const injected = typeof lookupPullRequestState === 'function';
  const state = injected ? (await lookupPullRequestState(pullRequestUrl)) || null : await lookupPullRequestStateViaGh(pullRequestUrl, { verbose });
  // Issue #2809: an open pull request whose latest session posted "Ready to
  // merge" is finished work too. An injected state lookup checks comments only
  // through an injected comment lookup, so tests never reach GitHub.
  if (!state || state.merged === true || state.readyToMerge !== undefined || (injected && typeof lookupCommentBodies !== 'function')) return state;
  if (String(state.state || 'open').toLowerCase() !== 'open') return state;
  return { ...state, readyToMerge: await resolveReadyToMerge(pullRequestUrl, { lookupCommentBodies, verbose }) };
}

async function lookupPullRequestStateViaGh(pullRequestUrl, { verbose = false } = {}) {
  const match = String(pullRequestUrl).match(PULL_REQUEST_URL_PATTERN);
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

export async function resolveFailedSessionPullRequestState({ pullRequestUrl, outcome, killEvidence = false, lookupPullRequestState = null, lookupCommentBodies = null, verbose = false, sessionName = 'unknown', exitCode = null, status = null, logPath = null } = {}) {
  // Issue #2498: a killed session, or a successful one that saw a container OOM
  // event, is checked too — once its pull request is merged the work is done,
  // so nothing may be recovered or reported as a recovery after the merge.
  if (!pullRequestUrl || !(outcome?.failed || outcome?.killed || killEvidence)) return null;
  const state = await resolvePullRequestState(pullRequestUrl, { lookupPullRequestState, lookupCommentBodies, verbose });
  if (verbose && state) {
    console.log(`[VERBOSE] Completion evidence for ${sessionName}: exitCode=${exitCode}, status=${status || 'unknown'}, pullRequest=${pullRequestUrl}, merged=${state.merged}, mergedAt=${state.mergedAt || 'unknown'}, readyToMerge=${state.readyToMerge ?? 'unknown'}, logPath=${logPath || 'unknown'}`);
  }
  return state;
}
