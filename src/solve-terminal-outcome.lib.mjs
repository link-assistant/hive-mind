/**
 * Process-local record of a durable successful solve outcome.
 *
 * A GitHub merge is externally committed and cannot be undone by later local
 * housekeeping. Once that outcome is confirmed, an internal exception during
 * log upload, cleanup, diagnostics, or shutdown must remain visible without
 * changing the solver's terminal exit from success to failure.
 */

let confirmedTerminalOutcome = null;

export function confirmPullRequestMerged({ owner = null, repo = null, prNumber = null, mergedAt = null } = {}) {
  if (confirmedTerminalOutcome) return confirmedTerminalOutcome;

  const normalizedPrNumber = Number(prNumber);
  if (!owner || !repo || !Number.isInteger(normalizedPrNumber) || normalizedPrNumber <= 0) {
    return null;
  }

  confirmedTerminalOutcome = Object.freeze({
    kind: 'pull_request_merged',
    owner: String(owner),
    repo: String(repo),
    prNumber: normalizedPrNumber,
    mergedAt: mergedAt || null,
    confirmedAt: new Date().toISOString(),
  });
  return confirmedTerminalOutcome;
}

export function getConfirmedTerminalOutcome() {
  return confirmedTerminalOutcome;
}

/**
 * Resolve an exit requested by Hive Mind's own error/finalization paths.
 *
 * External termination that bypasses these paths (for example SIGKILL or an
 * OOM kill) remains observable to the parent runner. This only prevents an
 * internal post-merge exception from contradicting a durable GitHub success.
 */
export function resolveInternalExitCode(requestedCode) {
  if (requestedCode === 0 || !confirmedTerminalOutcome) return requestedCode;
  return 0;
}

export function resetTerminalOutcomeForTests() {
  confirmedTerminalOutcome = null;
}
