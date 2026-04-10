/**
 * GitHub entity existence validation for /solve command.
 * Extracted from github.lib.mjs to keep files under 1500 line limit.
 * @see https://github.com/link-assistant/hive-mind/issues/1552
 */
if (typeof globalThis.use === 'undefined') globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
const { $ } = await use('command-stream');
import { ghCmdRetry } from './lib.mjs';
import { ghPrView, ghIssueView } from './github.lib.mjs';

/**
 * Validate existence of GitHub entities (user/org, repository, issue/PR) before executing a command.
 * Checks each level in order: user/org → repository → issue/PR, failing fast at the first missing entity.
 *
 * When autoAcceptInvite is enabled, invitations should be accepted BEFORE calling this function,
 * so that newly-accepted repos/orgs are visible to the API checks.
 *
 * @param {Object} options - Validation options
 * @param {string} options.owner - Repository owner (user or organization login)
 * @param {string} options.repo - Repository name
 * @param {number|string} [options.number] - Issue or PR number (if applicable)
 * @param {string} [options.type] - URL type: 'issue' or 'pull'
 * @param {boolean} [options.verbose=false] - Whether verbose logging is enabled
 * @returns {Promise<{valid: boolean, error?: string, level?: string, details?: string}>}
 *   - valid: true if all entities exist and are accessible
 *   - error: user-facing error message (when valid=false)
 *   - level: which entity level failed ('user', 'repo', 'issue', 'pull')
 *   - details: additional context for verbose logging
 */
export async function validateGitHubEntityExistence({ owner, repo, number, type, verbose = false }) {
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
        return {
          valid: false,
          error: `Repository '${owner}/${repo}' not found or not accessible.\n\n💡 Please check:\n• The repository name is spelled correctly\n• If it's a private repository, ensure the bot has been granted access (GitHub returns 404 for private repos without permissions)\n• The repository has not been deleted or transferred\n• If you were recently invited, try using --auto-accept-invite to accept pending invitations`,
          level: 'repo',
        };
      }
      verbose && console.log(`[VERBOSE] Entity check: Could not verify repo '${owner}/${repo}': ${errorOutput.trim()}`);
    }
  } catch (e) {
    verbose && console.log(`[VERBOSE] Entity check: Repo check error for '${owner}/${repo}': ${e.message}`);
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
