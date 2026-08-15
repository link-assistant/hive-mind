/**
 * Build the small repository objective sent through native CLIs to Formal AI.
 *
 * Formal AI owns the agent policy for its model. Repeating Hive Mind's native
 * provider policy in the request both wastes context and exposes incidental
 * shell-language cues to Formal AI's deterministic intent router (#2158).
 */

import { isFormalAiModel } from './formal-ai-model.lib.mjs';

export const buildFormalAiRepositoryPrompt = params => {
  if (!isFormalAiModel(params?.argv?.model)) return null;

  const { issueUrl, issueNumber, prNumber, prUrl, branchName, isContinueMode, feedbackLines, owner, repo } = params;
  const issueReference = isContinueMode && issueNumber && owner && repo ? `https://github.com/${owner}/${repo}/issues/${issueNumber}` : issueUrl || `the issue linked to pull request ${prNumber}`;
  const lines = [`Resolve the GitHub issue at ${issueReference} in this repository.`];

  if (branchName) lines.push(`Keep the solution on branch ${branchName}.`);
  if (prUrl) lines.push(`Update the pull request at ${prUrl}.`);
  // The review text is caller-controlled and can contain command snippets.
  // Point Formal AI to the canonical PR instead of copying those snippets into
  // the intent-classification request.
  if (feedbackLines?.length && prUrl) lines.push('Review and address all feedback recorded on that pull request.');

  lines.push('', 'Implement and verify the solution before reporting completion.', isContinueMode ? 'Continue.' : 'Proceed.');
  return `${lines.join('\n')}\n`;
};

export default { buildFormalAiRepositoryPrompt };
