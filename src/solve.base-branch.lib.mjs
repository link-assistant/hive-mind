import { validateBranchName } from './solve.branch.lib.mjs';
import { QUIET_PROBE } from './quiet-probe.lib.mjs';

const outputError = result => `${result.stderr?.toString() || ''}\n${result.stdout?.toString() || ''}`.trim() || `exit ${result.code}`;

/**
 * Create an explicitly requested, missing PR base in the canonical repository.
 * Run after read-only entity validation and before cloning so fork setup can
 * copy the branch from upstream using the existing custom-base sync path.
 * Uses POST to create a ref; existing branches are never updated or forced.
 *
 * @param {object} options
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {string} [options.baseBranch]
 * @param {boolean} [options.autoBaseBranchCreation=false]
 * @param {Function} options.$ - GitHub command runner with retry support.
 * @param {Function} [options.log] - Session logger.
 * @returns {Promise<void>}
 */
export async function ensureBaseBranchExists({ owner, repo, baseBranch, autoBaseBranchCreation = false, $, log = async () => {} }) {
  if (!autoBaseBranchCreation || !baseBranch) return;
  const validation = validateBranchName(baseBranch);
  if (!validation.valid) throw new Error(`Invalid base branch '${baseBranch}': ${validation.reason}`);

  const repositoryPath = `repos/${owner}/${repo}`;
  const branchPath = `${repositoryPath}/branches/${encodeURIComponent(baseBranch)}`;
  try {
    await log(`Checking base branch '${baseBranch}' in ${owner}/${repo}`, { verbose: true });
    const existing = await $(QUIET_PROBE)`gh api ${branchPath} --jq .name`;
    if (existing.code === 0) return;
    if (!/HTTP 404|Branch not found/i.test(outputError(existing))) {
      throw new Error(`Cannot verify base branch: ${outputError(existing)}`);
    }

    const defaultResult = await $(QUIET_PROBE)`gh api ${repositoryPath} --jq .default_branch`;
    const defaultBranch = defaultResult.stdout?.toString().trim();
    if (defaultResult.code !== 0 || !defaultBranch || defaultBranch === 'null') {
      throw new Error(`Cannot read repository default branch: ${outputError(defaultResult)}`);
    }
    const defaultPath = `${repositoryPath}/branches/${encodeURIComponent(defaultBranch)}`;
    const headResult = await $(QUIET_PROBE)`gh api ${defaultPath} --jq .commit.sha`;
    const sha = headResult.stdout?.toString().trim();
    if (headResult.code !== 0 || !/^[a-f0-9]{40}$/i.test(sha || '')) {
      throw new Error(`Cannot read the commit of default branch '${defaultBranch}'; ensure the repository has an initial commit. ${outputError(headResult)}`);
    }

    await log(`🌿 Creating base branch '${baseBranch}' in ${owner}/${repo} from '${defaultBranch}'`);
    const created = await $(QUIET_PROBE)`gh api ${`${repositoryPath}/git/refs`} --method POST -f ${`ref=refs/heads/${baseBranch}`} -f ${`sha=${sha}`} --jq .ref`;
    if (created.code === 0) {
      await log(`✅ Base branch '${baseBranch}' created in ${owner}/${repo}`);
      return;
    }

    // Concurrent solve workers can race between GET and POST. Reuse the winner's
    // branch without changing its tip; other failures retain their real cause.
    if (/Reference already exists/i.test(outputError(created))) {
      const recheck = await $(QUIET_PROBE)`gh api ${branchPath} --jq .name`;
      if (recheck.code === 0) {
        await log(`✅ Base branch '${baseBranch}' already exists in ${owner}/${repo}`);
        return;
      }
    }
    throw new Error(`Cannot create base branch '${baseBranch}' in ${owner}/${repo}. Ensure you have write access to the target repository or ask a maintainer to create it. ${outputError(created)}`);
  } catch (error) {
    throw new Error(`Cannot prepare base branch '${baseBranch}' in ${owner}/${repo}: ${error.message}`, { cause: error });
  }
}
