export const FORK_REPLACEMENT_BLOCKED_REASON_PREFIX = 'Repository setup halted - existing fork replacement could lose commits.';

const fallback = (value, replacement) => {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text || replacement;
};

export function summarizeGitHubCompareFailure(output = '') {
  const text = fallback(output, 'unknown compare error');
  const status = text.match(/HTTP\s+(\d+)/i)?.[1] || text.match(/"status"\s*:\s*"?(\d+)"?/i)?.[1] || null;
  const message = text.match(/"message"\s*:\s*"([^"]+)"/i)?.[1] || text.match(/gh:\s*([^\n(]+)/i)?.[1]?.trim() || null;

  if (status && message) return `${status} ${message}`;
  return message || status || text.split('\n')[0].slice(0, 160);
}

export function buildForkReplacementSafetyCheckDescription({ aheadBy = null, compareFailureOutput = '' } = {}) {
  if (Number.isFinite(aheadBy) && aheadBy > 0) {
    return `GitHub compare reported ${aheadBy} commit(s) ahead of upstream, so deleting the repository could lose commits.`;
  }

  if (compareFailureOutput) {
    return `GitHub compare returned ${summarizeGitHubCompareFailure(compareFailureOutput)}, so Hive Mind could not prove the repository has no unique commits.`;
  }

  return 'Hive Mind could not prove the repository has no unique commits.';
}

// GitHub Support's self-service fork request workflow. See
// https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/detaching-a-fork
export const GITHUB_FORK_SUPPORT_URL = 'https://support.github.com/request/fork';

/**
 * Explain how to recover the GitHub fork relationship without deleting the
 * existing repository. GitHub detaches a fork from its upstream network when the
 * repository's visibility is toggled (for example private -> public), and that
 * detachment is documented as permanent with no API/self-service reattachment.
 * The only non-deletion path is a GitHub Support request. See issue #2019.
 */
export function buildDetachedForkRecoveryGuidance({ existingRepository, expectedUpstream } = {}) {
  const repository = fallback(existingRepository, 'the existing repository');
  const upstream = fallback(expectedUpstream, 'the expected upstream repository');

  return `Recover the fork link WITHOUT deleting ${repository}: if ${repository} was once a GitHub fork of ${upstream} that got detached (for example after its visibility was switched to private and then back to public), the only path that keeps the repository is a GitHub Support request. Open ${GITHUB_FORK_SUPPORT_URL}, choose the "Attach, detach or reroute forks" flow, and ask to re-attach ${repository} to ${upstream}. GitHub documents visibility-change detachment as permanent, so reattachment is not guaranteed. While detached, ${repository} cannot open a cross-repository pull request to ${upstream}, so the solver needs either a reattached fork or a fresh fork to continue.`;
}

export function buildForkReplacementBlockedReason({ existingRepository, expectedUpstream, relationshipDescription, safetyCheckDescription, likelyDetachedFork = false } = {}) {
  const repository = fallback(existingRepository, 'the existing repository');
  const upstream = fallback(expectedUpstream, 'the expected upstream repository');
  const relationship = fallback(relationshipDescription, `${repository} is not a confirmed GitHub fork of ${upstream}.`);
  const safetyCheck = fallback(safetyCheckDescription, buildForkReplacementSafetyCheckDescription());
  const detachedForkNote = likelyDetachedFork ? `\n- Likely cause: ${repository} shares history with ${upstream} but GitHub reports it as a non-fork, which matches a fork that was detached from its network (commonly after a private/public visibility change).` : '';

  return `${FORK_REPLACEMENT_BLOCKED_REASON_PREFIX}

What happened:
- Expected fork or replacement repository: ${repository}
- Expected upstream: ${upstream}
- Actual state: ${relationship}${detachedForkNote}
- Safety check: ${safetyCheck}

Why it stopped:
Hive Mind did not delete ${repository} because the repository may contain commits that would be lost.

Options:
1. ${buildDetachedForkRecoveryGuidance({ existingRepository: repository, expectedUpstream: upstream })}
2. Back up any needed work in ${repository}, then delete, rename, archive, or repair that repository in GitHub and rerun the solver.
3. If you do not control ${repository}, ask the repository owner or a Hive Mind administrator to clean it up and rerun the solver.
4. Rerun with --allow-force-non-fork-repository-deletion only after confirming that deleting ${repository} is acceptable.`;
}

export function isForkReplacementBlockedReason(reason = '') {
  const text = String(reason || '');
  const normalized = text.toLowerCase();
  return normalized.includes(FORK_REPLACEMENT_BLOCKED_REASON_PREFIX.toLowerCase()) || normalized.includes('auto-recovery skipped - repository may contain commits that would be lost');
}

const extractLineValue = (reason, label) => {
  const pattern = new RegExp(`^- ${label}:\\s*(.+)$`, 'im');
  return (
    String(reason || '')
      .match(pattern)?.[1]
      ?.trim() || null
  );
};

export function extractForkReplacementBlockedDetails(reason = '') {
  return {
    existingRepository: extractLineValue(reason, 'Expected fork or replacement repository'),
    expectedUpstream: extractLineValue(reason, 'Expected upstream'),
  };
}
