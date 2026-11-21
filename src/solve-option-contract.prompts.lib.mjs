import { promptText } from './prompt-text.lib.mjs';
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

  return promptText('prompt.templates.solve-option-contract-prompts.buildRequestedBaseBranchDirective.text1', { baseBranch: String(baseBranch) });
}

export const buildLockedSolveOptionsDirective = buildRequestedBaseBranchDirective;
