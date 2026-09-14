/**
 * The mode-specific final instruction in every tool's "Preparing pull request"
 * section. Prompt wording experiments live outside src/ so this runtime path is
 * direct and reviewable.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2246
 */

import { isMergeableModeActive } from './pr-readiness-policy.lib.mjs';

const ITEM_PREFIX = '   - ';

export const getPullRequestLifecycleSubPrompt = ({ argv, prNumber, repoSuffix = '' } = {}) => {
  if (isMergeableModeActive(argv)) {
    return `${ITEM_PREFIX}When you finish implementation, leave the draft, ready for review, and ready to merge states to the Hive Mind system.`;
  }

  return `${ITEM_PREFIX}When you finish implementation, use gh pr ready ${prNumber ?? ''}${repoSuffix}.`;
};

export default { getPullRequestLifecycleSubPrompt };
