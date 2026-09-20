/**
 * Classify a rejected `git push` so the caller can pick the only recovery that
 * can work.
 *
 * Two rejections look alike in git's output — both print "rejected" — but they
 * need opposite responses:
 *
 *   lost race (rebase fixes it)
 *     ! [rejected] main -> main (non-fast-forward)
 *
 *   repository rule violation (rebase can NEVER fix it)
 *     remote: error: GH013: Repository rule violations found for refs/heads/main.
 *     remote: - Changes must be made through a pull request.
 *      ! [remote rejected] main -> main (push declined due to repository rule violations)
 *
 * Treating the second as the first is what makes a release die after the
 * version bump has already been committed in the runner: both push attempts
 * fail, and the log claims a race that never happened.
 *
 * Addresses issue:
 * - link-foundation/js-ai-driven-development-pipeline-template#143
 */

/**
 * Server-side refusals to accept a direct push: legacy branch protection
 * (GH006) and repository rulesets (GH013). No client-side history rewrite can
 * satisfy them; the change has to arrive through a pull request instead.
 */
export const REPOSITORY_RULE_PATTERNS = [
  'gh006', // legacy protected-branch rejection
  'gh013', // repository rule violations
  'repository rule violations',
  'changes must be made through a pull request',
  'protected branch',
  'push declined',
];

/**
 * Rejections caused by the remote branch having advanced. Only these are fixed
 * by rebasing onto the new remote head and pushing again.
 */
export const NON_FAST_FORWARD_PATTERNS = [
  '[rejected]',
  'non-fast-forward',
  'fetch first',
  'updates were rejected',
];

/**
 * Flatten a command result (or Error) into one lowercase haystack.
 * @param {{stdout?: string, stderr?: string, message?: string}|string} result
 * @param {boolean} [includeMessage] - Include `message` (Error text) in the haystack
 * @returns {string}
 */
function combinedOutput(result, includeMessage = true) {
  if (typeof result === 'string') {
    return result.toLowerCase();
  }
  const parts = [result?.stdout || '', result?.stderr || ''];
  if (includeMessage) {
    parts.push(result?.message || '');
  }
  return parts.join('\n').toLowerCase();
}

/**
 * Whether the remote rejected the push because of branch protection or a
 * repository ruleset.
 * @param {{stdout?: string, stderr?: string, message?: string}|string} result
 * @returns {boolean}
 */
export function isBlockedByRepositoryRule(result) {
  const output = combinedOutput(result);
  return REPOSITORY_RULE_PATTERNS.some((pattern) => output.includes(pattern));
}

/**
 * Whether the remote rejected the push because the branch has advanced.
 *
 * A ruleset rejection also prints "rejected", so it is excluded first: rebasing
 * can never satisfy a rule, and misreading it as a lost race burns the retry
 * and reports the wrong cause.
 * @param {{stdout?: string, stderr?: string, message?: string}|string} result
 * @returns {boolean}
 */
export function isNonFastForward(result) {
  if (isBlockedByRepositoryRule(result)) {
    return false;
  }
  const output = combinedOutput(result, false);
  return NON_FAST_FORWARD_PATTERNS.some((pattern) => output.includes(pattern));
}
