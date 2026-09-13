/**
 * Pull request lifecycle sub-prompt.
 *
 * Issue #2246: every tool prompt used to end the "Preparing pull request" section with
 * "When you finish implementation, use gh pr ready <number>." That single line made the
 * AI worker take the pull request out of draft the moment it *thought* it was done —
 * before CI/CD had said anything — which is exactly the state in which
 * https://github.com/Time0utXC/digitalstructures.pro/pull/4 was merged by a human while
 * the AI was still working (0 checks, body still "Work in Progress").
 *
 * The draft/ready state machine belongs to hive-mind (pr-draft-state.lib.mjs, issues
 * #2123 and #2182), so the prompts now say so, and they state the actual goal of the
 * work: a *mergeable* pull request, with every CI/CD check green — including checks that
 * look unrelated to the issue.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2246
 */

import { isMergeableModeActive } from './pr-readiness-policy.lib.mjs';

/**
 * Build the pull request lifecycle sub-prompt.
 *
 * @param {Object} argv - Command line arguments (used to detect the operating mode)
 * @param {Object} [context]
 * @param {number|string} [context.prNumber] - Pull request the AI works on
 * @returns {string} The formatted sub-prompt lines (no trailing newline)
 */
export const getPullRequestLifecycleSubPrompt = (argv, { prNumber } = {}) => {
  const prRef = prNumber ? `pull request ${prNumber}` : 'the pull request';
  const lines = [];

  lines.push(`   - When you finish implementation, do not run gh pr ready or gh pr ready --undo: the draft and ready for review states of ${prRef} are handled by the Hive Mind system, and there is no need to change the pull request state manually.`);

  if (isMergeableModeActive(argv)) {
    lines.push('   - When you see the pull request is a draft, leave it as a draft: the Hive Mind system takes it out of draft by itself, and only once it has verified the `ready to merge` state (all CI/CD checks passing, no merge conflicts). If the pull request state is changed manually, the Hive Mind system restores it.');
    lines.push('   - When you decide the work is done, remember the goal of the work is to make the pull request mergeable: all CI/CD checks must pass, even the checks that look unrelated to the boundaries of the issue, and the branch must have no merge conflicts with its base branch.');
    lines.push('   - When a CI/CD check fails for a reason that looks unrelated to your changes, treat it as part of your work anyway: investigate the failure, fix it, or explain in the pull request why it cannot be fixed.');
  } else {
    lines.push('   - When you see the pull request is a draft, leave it as a draft: the Hive Mind system marks it ready for review by itself when the working session ends.');
    lines.push('   - When you decide the work is done, remember the goal of the work is to make the pull request mergeable: all CI/CD checks must pass, even the checks that look unrelated to the boundaries of the issue.');
  }

  return lines.join('\n');
};

export default {
  getPullRequestLifecycleSubPrompt,
};
