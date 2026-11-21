import { collectAndCommitDevelopmentLogArtifacts } from './development-log.lib.mjs';
import { wrapDollarWithGhRetry } from './github-rate-limit.lib.mjs';

/** Preserve an attachment on the existing PR branch when Gists are unavailable. */
export async function publishLogToPullRequestBranch({ logFile, repositoryPath, owner, repo, prNumber, $, log, sessionId = null }) {
  const failed = reason => ({ success: false, failureReason: reason });
  const safeDollar = wrapDollarWithGhRetry($);
  const command = safeDollar({ cwd: repositoryPath, mirror: false, capture: true });
  const view = await command`gh pr view ${String(prNumber)} --repo ${`${owner}/${repo}`} --json headRefName,baseRefName,headRepository,headRepositoryOwner`;
  if (view.code !== 0) return failed('Could not verify the pull request branch');
  const pr = JSON.parse(view.stdout.toString());
  const headRepository = `${pr.headRepositoryOwner?.login}/${pr.headRepository?.name}`;
  const branch = pr.headRefName;
  if (!branch || branch === pr.baseRefName || ['main', 'master'].includes(branch) || !pr.headRepositoryOwner?.login || !pr.headRepository?.name) return failed('Missing or unsafe pull request head');
  const local = await command`git branch --show-current`;
  if (local.code !== 0 || local.stdout.toString().trim() !== branch) return failed('Checkout does not match the pull request head');
  const origin = await command`git remote get-url --push origin`;
  const remoteRepository = origin.stdout
    .toString()
    .trim()
    .match(/^(?:https:\/\/(?:[^/@]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
  if (origin.code !== 0 || remoteRepository?.toLowerCase() !== headRepository.toLowerCase()) return failed('Origin does not match the pull request head repository');

  await log?.('  🧾 Preserving the complete sanitized log on the pull request branch');
  const artifacts = await collectAndCommitDevelopmentLogArtifacts({
    enabled: true,
    repositoryPath,
    logFile,
    issueNumber: branch.match(/^issue-(\d+)-/)?.[1] || null,
    prNumber,
    branchName: branch,
    sessionId,
    $: safeDollar,
    log,
  });
  if (!artifacts.pushed || !artifacts.copiedLogRelativePath) return failed('Could not push the log attachment to the pull request branch');
  const commit = await command`git rev-parse HEAD`;
  const sha = commit.stdout.toString().trim();
  if (commit.code !== 0 || !/^[a-f\d]{40,64}$/i.test(sha)) return failed('Could not resolve the published log commit');
  const file = artifacts.copiedLogRelativePath.split('/').map(encodeURIComponent).join('/');
  const url = `https://github.com/${headRepository}/blob/${sha}/${file}`;
  return { success: true, type: 'repository', url, rawUrl: url, chunks: 1 };
}
