import { ensureUseM } from './use-m-bootstrap.lib.mjs';
/**
 * GitHub entity existence validation for /solve command.
 * Extracted from github.lib.mjs to keep files under 1500 line limit.
 * @see https://github.com/link-assistant/hive-mind/issues/1552
 */
if (typeof globalThis.use === 'undefined') await ensureUseM();
const { $ } = await use('command-stream');
import { ghCmdRetry } from './lib.mjs';
import { ghPrView, ghIssueView } from './github.lib.mjs';

/**
 * Compute the Levenshtein edit distance between two strings.
 * Used to suggest the closest existing branch name when a requested base
 * branch is not found (issue #1959 — typos like an extra trailing character).
 *
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} The minimum number of single-character edits
 */
export function levenshteinDistance(a, b) {
  a = String(a);
  b = String(b);
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Single-row dynamic programming to keep memory at O(min(len)).
  let previousRow = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const currentRow = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const insertCost = currentRow[j] + 1;
      const deleteCost = previousRow[j + 1] + 1;
      const replaceCost = previousRow[j] + (a[i] === b[j] ? 0 : 1);
      currentRow.push(Math.min(insertCost, deleteCost, replaceCost));
    }
    previousRow = currentRow;
  }
  return previousRow[b.length];
}

/**
 * Find the closest matching branch name to a (likely mistyped) target.
 * Returns the nearest candidate only when it is close enough to be a plausible
 * typo, so we never suggest an unrelated branch.
 *
 * @param {string} target - The requested (not found) branch name
 * @param {string[]} candidates - Existing branch names to compare against
 * @returns {string|null} The closest branch name, or null if none is close enough
 */
export function findClosestBranchName(target, candidates) {
  if (!target || !Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }
  // Allow a larger edit budget for longer names, but cap it so unrelated
  // branches are never suggested (e.g. a 1-char typo on a 23-char branch).
  const maxDistance = Math.max(2, Math.floor(target.length * 0.34));
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    if (!candidate || candidate === target) continue;
    const distance = levenshteinDistance(target, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= maxDistance ? best : null;
}

/**
 * Check whether a branch exists in the given repository using the GitHub API.
 * Works without cloning the repo, so it can run during early validation
 * (before the heavy clone/spawn work) for both the CLI and the Telegram bot.
 *
 * @param {Object} options
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {string} options.baseBranch - Branch name to check
 * @param {boolean} [options.verbose=false] - Verbose logging
 * @returns {Promise<{exists: boolean, indeterminate?: boolean}>}
 *   - exists: true if the branch is present (or the check was inconclusive — fail open)
 *   - indeterminate: true when a non-404 error prevented a definitive answer
 */
export async function checkBaseBranchExists({ owner, repo, baseBranch, verbose = false }) {
  try {
    const result = await ghCmdRetry(() => $`gh api repos/${owner}/${repo}/branches/${baseBranch} --jq .name`, { label: `check branch ${baseBranch}` });
    if (result.code === 0) {
      return { exists: true };
    }
    const errorOutput = (result.stderr ? result.stderr.toString() : '') + (result.stdout ? result.stdout.toString() : '');
    if (errorOutput.includes('404') || errorOutput.includes('Not Found') || errorOutput.includes('Branch not found')) {
      return { exists: false };
    }
    // Non-404 errors (network, auth, rate limit): fail open so we don't block on transient issues.
    verbose && console.log(`[VERBOSE] Entity check: Could not verify branch '${baseBranch}': ${errorOutput.trim()}`);
    return { exists: true, indeterminate: true };
  } catch (e) {
    verbose && console.log(`[VERBOSE] Entity check: Branch check error for '${baseBranch}': ${e.message}`);
    return { exists: true, indeterminate: true };
  }
}

/**
 * Build a user-facing error message for a missing base branch, optionally
 * including a "did you mean" suggestion derived from the repo's branches.
 *
 * @param {Object} options
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {string} options.baseBranch
 * @param {boolean} [options.verbose=false]
 * @returns {Promise<string>} The formatted error message
 */
export async function buildMissingBaseBranchErrorMessage({ owner, repo, baseBranch, verbose = false }) {
  let suggestion = '';
  try {
    const listResult = await ghCmdRetry(() => $`gh api repos/${owner}/${repo}/branches --paginate --jq .[].name`, { label: `list branches ${owner}/${repo}` });
    if (listResult.code === 0) {
      const branches = listResult.stdout
        .toString()
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);
      const closest = findClosestBranchName(baseBranch, branches);
      if (closest) {
        suggestion = `\n\n💡 Did you mean '${closest}'? (closest existing branch)`;
      }
    }
  } catch (e) {
    verbose && console.log(`[VERBOSE] Entity check: Could not list branches for suggestion: ${e.message}`);
  }
  const listCmd = `gh api repos/${owner}/${repo}/branches --paginate --jq .[].name`;
  return `Base branch '${baseBranch}' does not exist in ${owner}/${repo}.${suggestion}\n\n💡 Please check:\n• The branch name is spelled correctly\n• The branch has not been deleted or renamed\n• Omit --base-branch to use the repository's default branch\n• List existing branches: ${listCmd}`;
}

/**
 * Validate existence of GitHub entities (user/org, repository, base branch, issue/PR)
 * before executing a command. Checks each level in order, failing fast at the first
 * missing entity: user/org → repository → base branch → issue/PR.
 *
 * When autoAcceptInvite is enabled, invitations should be accepted BEFORE calling this function,
 * so that newly-accepted repos/orgs are visible to the API checks.
 *
 * @param {Object} options - Validation options
 * @param {string} options.owner - Repository owner (user or organization login)
 * @param {string} options.repo - Repository name
 * @param {number|string} [options.number] - Issue or PR number (if applicable)
 * @param {string} [options.type] - URL type: 'issue' or 'pull'
 * @param {string} [options.baseBranch] - Custom base branch (from --base-branch/--target-branch).
 *   When provided, its existence is verified up-front so a typo fails fast with a clear
 *   message instead of an opaque "Branch operation failed" after cloning (issue #1959).
 * @param {boolean} [options.verbose=false] - Whether verbose logging is enabled
 * @param {boolean} [options.autoAcceptInvite=false] - Whether the caller already passed
 *   `--auto-accept-invite`. When true, the repo-404 message omits the suggestion to
 *   use that flag, since it would not be actionable (issue #1692).
 * @returns {Promise<{valid: boolean, error?: string, level?: string, details?: string}>}
 *   - valid: true if all entities exist and are accessible
 *   - error: user-facing error message (when valid=false)
 *   - level: which entity level failed ('user', 'repo', 'branch', 'issue', 'pull')
 *   - details: additional context for verbose logging
 */
export async function validateGitHubEntityExistence({ owner, repo, number, type, baseBranch, verbose = false, autoAcceptInvite = false }) {
  // Step 1: Check user/organization existence
  try {
    const userResult = await ghCmdRetry(() => $`gh api users/${owner} --jq .login`, { label: `check user ${owner}` });
    if (userResult.code !== 0) {
      const errorOutput = (userResult.stderr ? userResult.stderr.toString() : '') + (userResult.stdout ? userResult.stdout.toString() : '');
      if (errorOutput.includes('404') || errorOutput.includes('Not Found')) {
        return {
          valid: false,
          error: `GitHub user or organization '${owner}' does not exist.\n\n💡 Please check:\n• The username/organization name is spelled correctly\n• The account has not been deleted or renamed`,
          level: 'user',
        };
      }
      // Non-404 errors (network, auth) - don't block, let downstream handle
      verbose && console.log(`[VERBOSE] Entity check: Could not verify user '${owner}': ${errorOutput.trim()}`);
    }
  } catch (e) {
    verbose && console.log(`[VERBOSE] Entity check: User check error for '${owner}': ${e.message}`);
  }

  // Step 2: Check repository existence
  try {
    const repoResult = await ghCmdRetry(() => $`gh api repos/${owner}/${repo} --jq .full_name`, { label: `check repo ${owner}/${repo}` });
    if (repoResult.code !== 0) {
      const errorOutput = (repoResult.stderr ? repoResult.stderr.toString() : '') + (repoResult.stdout ? repoResult.stdout.toString() : '');
      if (errorOutput.includes('404') || errorOutput.includes('Not Found')) {
        const bullets = ['• Repository may be private — ensure the bot has been granted access', '• The repository name is spelled correctly', '• The repository has not been deleted, transferred, or never existed'];
        if (!autoAcceptInvite) {
          bullets.push('• If Hive Mind bot was recently invited, try using --auto-accept-invite to accept pending invitations');
        }
        return {
          valid: false,
          error: `Repository '${owner}/${repo}' is not accessible.\n\n💡 Please check:\n${bullets.join('\n')}`,
          level: 'repo',
        };
      }
      verbose && console.log(`[VERBOSE] Entity check: Could not verify repo '${owner}/${repo}': ${errorOutput.trim()}`);
    }
  } catch (e) {
    verbose && console.log(`[VERBOSE] Entity check: Repo check error for '${owner}/${repo}': ${e.message}`);
  }

  // Step 2.5: Check base branch existence (issue #1959)
  // When the user passes --base-branch/--target-branch, verify it exists in the
  // canonical repository up-front. A typo (e.g. an extra trailing character) would
  // otherwise surface only after cloning as an opaque "Branch operation failed",
  // and was even misdiagnosed as an "empty repository". Failing here gives the
  // same fast, explicit feedback we already provide for repo/issue/PR — in the CLI
  // and in the GitHub comment, and BEFORE the Telegram bot starts the solve run.
  if (baseBranch) {
    const branchCheck = await checkBaseBranchExists({ owner, repo, baseBranch, verbose });
    if (!branchCheck.exists) {
      return {
        valid: false,
        error: await buildMissingBaseBranchErrorMessage({ owner, repo, baseBranch, verbose }),
        level: 'branch',
      };
    }
  }

  // Step 3: Check issue or PR existence (if number is provided)
  if (number) {
    if (type === 'pull') {
      try {
        const prResult = await ghPrView({ prNumber: number, owner, repo, jsonFields: 'number,state' });
        if (prResult.code !== 0 || !prResult.data) {
          const errorOutput = prResult.output || '';
          if (errorOutput.includes('Could not resolve') || errorOutput.includes('not found') || errorOutput.includes('404')) {
            // Check if an issue with this number exists (common confusion)
            let suggestion = '';
            try {
              const issueCheck = await ghIssueView({ issueNumber: number, owner, repo, jsonFields: 'number,title' });
              if (issueCheck.code === 0 && issueCheck.data) {
                suggestion = `\n\n💡 However, Issue #${number} exists: "${issueCheck.data.title}"\n   Did you mean: https://github.com/${owner}/${repo}/issues/${number}`;
              }
            } catch {
              /* ignore */
            }
            return {
              valid: false,
              error: `Pull request #${number} does not exist in ${owner}/${repo}.${suggestion}\n\n💡 Please check:\n• The PR number is correct\n• The PR has not been deleted`,
              level: 'pull',
            };
          }
          verbose && console.log(`[VERBOSE] Entity check: Could not verify PR #${number}: ${errorOutput.trim()}`);
        }
      } catch (e) {
        verbose && console.log(`[VERBOSE] Entity check: PR check error for #${number}: ${e.message}`);
      }
    } else {
      // type === 'issue' or default
      try {
        const issueResult = await ghIssueView({ issueNumber: number, owner, repo, jsonFields: 'number,title' });
        if (issueResult.code !== 0 || !issueResult.data) {
          const errorOutput = issueResult.output || '';
          if (errorOutput.includes('Could not resolve') || errorOutput.includes('not found') || errorOutput.includes('404')) {
            // Check if a PR with this number exists (common confusion)
            let suggestion = '';
            try {
              const prCheck = await ghPrView({ prNumber: number, owner, repo, jsonFields: 'number,title' });
              if (prCheck.code === 0 && prCheck.data) {
                suggestion = `\n\n💡 However, Pull Request #${number} exists: "${prCheck.data.title}"\n   Did you mean: https://github.com/${owner}/${repo}/pull/${number}`;
              }
            } catch {
              /* ignore */
            }
            return {
              valid: false,
              error: `Issue #${number} does not exist in ${owner}/${repo}.${suggestion}\n\n💡 Please check:\n• The issue number is correct\n• The issue has not been deleted or transferred`,
              level: 'issue',
            };
          }
          verbose && console.log(`[VERBOSE] Entity check: Could not verify issue #${number}: ${errorOutput.trim()}`);
        }
      } catch (e) {
        verbose && console.log(`[VERBOSE] Entity check: Issue check error for #${number}: ${e.message}`);
      }
    }
  }

  return { valid: true };
}
