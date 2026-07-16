/**
 * Prompt snippets for user-requested solve options.
 */

function normalizeBranchName(value) {
  return String(value || '').trim();
}

export function buildRequestedBaseBranchDirective(argv = {}) {
  const baseBranch = normalizeBranchName(argv?.baseBranch);
  if (!baseBranch) {
    return '';
  }

  return `Requested by user --base-branch: ${baseBranch}
The user expects the pull request base branch to remain ${baseBranch}.`;
}

export const buildLockedSolveOptionsDirective = buildRequestedBaseBranchDirective;
