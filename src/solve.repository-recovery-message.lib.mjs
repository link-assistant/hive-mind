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

export function buildForkReplacementBlockedReason({ existingRepository, expectedUpstream, relationshipDescription, safetyCheckDescription } = {}) {
  const repository = fallback(existingRepository, 'the existing repository');
  const upstream = fallback(expectedUpstream, 'the expected upstream repository');
  const relationship = fallback(relationshipDescription, `${repository} is not a confirmed GitHub fork of ${upstream}.`);
  const safetyCheck = fallback(safetyCheckDescription, buildForkReplacementSafetyCheckDescription());

  return `${FORK_REPLACEMENT_BLOCKED_REASON_PREFIX}

What happened:
- Expected fork or replacement repository: ${repository}
- Expected upstream: ${upstream}
- Actual state: ${relationship}
- Safety check: ${safetyCheck}

Why it stopped:
Hive Mind did not delete ${repository} because the repository may contain commits that would be lost.

Options:
1. Back up any needed work in ${repository}, then delete, rename, archive, or repair that repository in GitHub and rerun the solver.
2. If you do not control ${repository}, ask the repository owner or a Hive Mind administrator to clean it up and rerun the solver.
3. Rerun with --allow-force-non-fork-repository-deletion only after confirming that deleting ${repository} is acceptable.`;
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
