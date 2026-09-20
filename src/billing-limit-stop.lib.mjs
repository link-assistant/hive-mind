#!/usr/bin/env node

/**
 * What `--auto-restart-until-mergeable` does when GitHub Actions will not run
 * for billing reasons.
 *
 * Issue #1314: a billing limit is not a code failure. Restarting the AI cannot
 * pay the bill, so the private-repository case stops the loop and asks a human,
 * and the (unusual) public-repository case only backs off and waits.
 *
 * Extracted from `solve.auto-merge.lib.mjs` under issue #2247, which brought
 * that file back over the 1350-line warning threshold
 * (`scripts/check-file-line-limits.sh`). The behaviour is unchanged; it is the
 * same code, now with its own name and its dependencies passed in.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1314
 */

import { BILLING_LIMIT_ERROR_PATTERN, getRepoVisibility as getRepoVisibilityImpl } from './github-merge.lib.mjs';

/** The comment a human has to act on; nothing here is actionable by the AI. */
export const buildBillingLimitComment = blocker => `## 💳 GitHub Actions Billing Limit Reached

The CI/CD jobs could not start due to billing/spending limits.

**Affected jobs:**
${(blocker?.details || []).map(job => `- ${job}`).join('\n')}

**Error message:**
> ${blocker?.billingMessage || BILLING_LIMIT_ERROR_PATTERN}

**Action Required:**
Please check the 'Billing & plans' section in your GitHub settings and either:
1. Add or update your payment method
2. Increase your spending limit
3. Wait for the free tier limits to reset (if applicable)

Once the billing issue is resolved, you can re-run the CI checks or push a new commit to trigger a new run.

---
*Detected by hive-mind with --auto-restart-until-mergeable flag. This is NOT a code issue - human intervention is required.*`;

/** Public repositories have free CI, so a limit there is odd; wait it out. */
export const nextBillingBackoffSeconds = (seconds, max = 3600) => Math.min((Number(seconds) || 1) * 2, max);

/**
 * Report a billing-limit blocker and decide whether the loop can continue.
 *
 * @param {Object} params
 * @param {Object} params.blocker - the `billing_limit` entry from `getMergeBlockers`
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number|string} params.prNumber
 * @param {Function} params.$ - command-stream tagged template
 * @param {Function} params.log
 * @param {Function} params.formatAligned
 * @param {Function} params.postComment - `postTrackedComment`
 * @param {Function} params.reportError
 * @param {number} params.backoffSeconds - the loop's current backoff
 * @param {boolean} [params.verbose]
 * @param {Function} [params.getRepoVisibility] - test seam
 * @returns {Promise<{stopped: boolean, backoffSeconds: number}>}
 */
export const handleBillingLimitBlocker = async ({ blocker, owner, repo, prNumber, $: command, log, formatAligned, postComment, reportError, backoffSeconds, verbose = false, getRepoVisibility = getRepoVisibilityImpl }) => {
  await log('');
  await log(formatAligned('💳', 'GITHUB ACTIONS BILLING LIMIT DETECTED', ''));
  await log(formatAligned('', 'Affected jobs:', (blocker?.details || []).join(', '), 2));
  await log(formatAligned('', 'All jobs affected:', blocker?.allJobsAffected ? 'Yes' : 'No', 2));
  await log('');

  const repoInfo = await getRepoVisibility(owner, repo, verbose);
  if (!repoInfo?.isPrivate) {
    await log(formatAligned('⏳', 'Public repository with billing limit (unusual)', 'Applying exponential backoff'));
    await log(formatAligned('', 'Next check in:', `${backoffSeconds} seconds`, 2));
    // No AI restart: the backoff at the end of the loop is the whole response.
    return { stopped: false, backoffSeconds: nextBillingBackoffSeconds(backoffSeconds) };
  }

  await log(formatAligned('🛑', 'STOPPING', 'Private repository - billing limit requires human intervention'));
  await log(formatAligned('', 'Action required:', "Check the 'Billing & plans' section in your GitHub settings", 2));
  try {
    await postComment({ $: command, owner, repo, targetNumber: prNumber, body: buildBillingLimitComment(blocker) });
    await log(formatAligned('', '💬 Posted billing limit notification to PR', '', 2));
  } catch (commentError) {
    reportError(commentError, { context: 'post_billing_limit_comment', owner, repo, prNumber, operation: 'comment_on_pr' });
    await log(formatAligned('', '⚠️  Could not post comment to PR', '', 2));
  }
  return { stopped: true, backoffSeconds };
};

export default { buildBillingLimitComment, handleBillingLimitBlocker, nextBillingBackoffSeconds };
