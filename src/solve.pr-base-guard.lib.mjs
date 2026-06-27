/**
 * Guard PR base branch changes made during an agent session.
 *
 * The solve command creates or continues work against a target base branch.
 * When --base-branch is explicit, that target is a user request, not a
 * suggestion for the agent to retarget later.
 */

import { ghWithRateLimitRetry } from './github-rate-limit.lib.mjs';

function normalizeBranchName(value) {
  return String(value || '').trim();
}

function commandOutput(result) {
  return [result?.stderr, result?.stdout]
    .filter(Boolean)
    .map(output => output.toString().trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function fallbackFormatAligned(icon, label, value) {
  return [icon, label, value].filter(Boolean).join(' ');
}

export function getExpectedPullRequestBaseBranch({ argv = {} } = {}) {
  const requestedBaseBranch = normalizeBranchName(argv?.baseBranch);
  return requestedBaseBranch || null;
}

export async function getPullRequestBaseBranch({ owner, repo, prNumber, $, log }) {
  if (typeof $ !== 'function') {
    throw new Error('Cannot verify pull request base branch without a command runner');
  }

  const result = await ghWithRateLimitRetry(() => $`gh pr view ${prNumber} --repo ${owner}/${repo} --json baseRefName --jq .baseRefName`, {
    label: 'gh pr view baseRefName',
    log,
  });
  if (result.code !== 0) {
    const details = commandOutput(result) || 'unknown error';
    throw new Error(`Could not verify pull request base branch for #${prNumber}: ${details}`);
  }

  const baseBranch = normalizeBranchName(result.stdout);
  if (!baseBranch) {
    throw new Error(`Could not verify pull request base branch for #${prNumber}: gh returned an empty baseRefName`);
  }

  return baseBranch;
}

export async function ensurePullRequestBaseBranch({ owner, repo, prNumber, argv = {}, log = async () => {}, formatAligned = fallbackFormatAligned, $ }) {
  const expectedBaseBranch = getExpectedPullRequestBaseBranch({ argv });
  if (!expectedBaseBranch) {
    return { checked: false, restored: false, reason: 'no_explicit_base_branch' };
  }

  if (!owner || !repo || !prNumber) {
    return { checked: false, restored: false, reason: 'missing_pull_request_context' };
  }

  const currentBaseBranch = await getPullRequestBaseBranch({ owner, repo, prNumber, $, log });
  if (currentBaseBranch === expectedBaseBranch) {
    await log(formatAligned('🎯', 'Base branch locked:', `${expectedBaseBranch} (verified)`, 2), { verbose: true });
    return {
      checked: true,
      restored: false,
      currentBaseBranch,
      expectedBaseBranch,
    };
  }

  await log(formatAligned('⚠️', 'Base branch changed:', `PR #${prNumber} targets ${currentBaseBranch}, expected ${expectedBaseBranch}`, 2), { level: 'warning' });
  await log(formatAligned('🔁', 'Restoring PR base:', expectedBaseBranch, 2));

  const editResult = await ghWithRateLimitRetry(() => $`gh pr edit ${prNumber} --repo ${owner}/${repo} --base ${expectedBaseBranch}`, {
    label: 'gh pr edit base',
    log,
  });
  if (editResult.code !== 0) {
    const details = commandOutput(editResult) || 'unknown error';
    throw new Error(`Could not restore pull request #${prNumber} base branch to ${expectedBaseBranch}: ${details}`);
  }

  const restoredBaseBranch = await getPullRequestBaseBranch({ owner, repo, prNumber, $, log });
  if (restoredBaseBranch !== expectedBaseBranch) {
    throw new Error(`Pull request #${prNumber} still targets ${restoredBaseBranch} after attempting to restore ${expectedBaseBranch}`);
  }

  await log(formatAligned('✅', 'Base branch restored:', `PR #${prNumber} now targets ${expectedBaseBranch}`, 2));

  return {
    checked: true,
    restored: true,
    previousBaseBranch: currentBaseBranch,
    currentBaseBranch: restoredBaseBranch,
    expectedBaseBranch,
  };
}
