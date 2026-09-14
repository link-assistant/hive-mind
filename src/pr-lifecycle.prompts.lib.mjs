/**
 * Pull request lifecycle sub-prompt: one line, shared by every tool prompt.
 *
 * Issue #2246: every tool prompt used to end the "Preparing pull request" section with
 * "When you finish implementation, use gh pr ready <number>." That single line made the
 * AI worker take the pull request out of draft the moment it *thought* it was done —
 * before CI/CD had said anything — which is exactly the state in which
 * https://github.com/Time0utXC/digitalstructures.pro/pull/4 was merged by a human while
 * the AI was still working (0 checks, body still "Work in Progress").
 *
 * The draft/ready state machine belongs to hive-mind (pr-draft-state.lib.mjs, issues
 * #2123 and #2182), so the line that replaces it says so, and states the actual goal of
 * the work: a *mergeable* pull request, with every CI/CD check green — including checks
 * that look unrelated to the issue.
 *
 * It replaces one line with one line on purpose (review feedback on #2248): the system
 * prompt is re-sent on every conversation turn, so every sentence here is paid for many
 * times over. The operating mode is deliberately not spelled out — whichever mode is
 * active, the instruction to the AI is identical, and the mode is communicated to the
 * *human* instead (pr-readiness-policy.lib.mjs).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2246
 */

/**
 * The pull request lifecycle instruction, formatted as one item of the
 * "Preparing pull request" list (no trailing newline).
 *
 * @returns {string}
 */
export const getPullRequestLifecycleSubPrompt = () => '   - When you finish implementation, do not change the pull request state: the Hive Mind system owns the draft, ready for review and ready to merge states, and your goal is a mergeable pull request, so all CI/CD checks must pass, even ones that look unrelated to the issue.';

export default {
  getPullRequestLifecycleSubPrompt,
};
