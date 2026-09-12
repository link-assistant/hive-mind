/**
 * Issue #2239 — fork-mode warning for screenshot links.
 *
 * Issue #1561 made the screenshot example fork-aware: in fork mode the example
 * URL prints the fork's `owner/repo` instead of the upstream one. That was
 * necessary but not sufficient. On Godmy/frontend#2 the prompt correctly said
 * `konard/frontend`, and the tool still published
 * `https://github.com/Godmy/frontend/blob/issue-1-46ba053c/...` — the upstream
 * path it had been reading and writing about for the whole session — which 404s
 * because the branch lives only in the fork.
 *
 * A single interpolated example is easy to overwrite from memory, so in fork
 * mode this adds the reason as well as the rule: which repository holds the
 * branch, what happens if the other one is used, and how to check.
 *
 * The deterministic backstop is `src/pr-image-link-repair.lib.mjs`, which
 * verifies and repairs published links after the session ends.
 */

/**
 * Build the fork-specific screenshot link warning.
 *
 * @param {Object} options
 * @param {boolean} [options.isFork] - true when the branch is pushed to a fork
 * @param {string} [options.screenshotRepoPath] - `owner/repo` holding the branch
 * @param {string} [options.upstreamRepoPath] - `owner/repo` hosting the pull request
 * @param {string} [options.branchName]
 * @returns {string} lines to append, or '' when not in fork mode
 */
export const buildForkScreenshotLinkWarning = ({ isFork, screenshotRepoPath, upstreamRepoPath, branchName } = {}) => {
  if (!isFork || !screenshotRepoPath || !upstreamRepoPath || screenshotRepoPath === upstreamRepoPath) return '';
  return `
   - When you link to a screenshot or any other file on the branch, the repository in the URL must be ${screenshotRepoPath}, because branch ${branchName} is pushed to the fork ${screenshotRepoPath} and does not exist in ${upstreamRepoPath}.
   - When you write an image link, do not substitute ${upstreamRepoPath} for ${screenshotRepoPath} even though the pull request itself lives in ${upstreamRepoPath}: a branch file requested from ${upstreamRepoPath} answers 404 and the image renders as broken.
   - When you have written the pull request description, verify every image link before finishing, for example with: gh api repos/${screenshotRepoPath}/contents/docs/screenshots/result.png?ref=${branchName} --jq .sha`;
};

export default { buildForkScreenshotLinkWarning };
