/**
 * Bounded completion restarts (issue #2406): after the solve, re-run the tool
 * until the merge guard accepts the pull request's requirements report. Runs
 * without any optional flag; --ensure-all-sub-issues-addressed only raises the
 * bound. The merge guard itself stays mandatory whatever this loop concludes.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { checkIssueCompletionBeforeMerge } from './issue-completion.lib.mjs';
import { ISSUE_COMPLETION_GOAL } from './issue-completion.prompts.lib.mjs';
import { normalizeEnsureSubIssuesLimit } from './solve.ensure-sub-issues.detect.lib.mjs';

export const DEFAULT_ISSUE_COMPLETION_RESTARTS = 3;
const MAX_CONSECUTIVE_FAILURES = 3;

const defaultExecute = async iteration => {
  const { executeToolIteration, isApiError } = await import('./solve.restart-shared.lib.mjs');
  const result = await executeToolIteration(iteration);
  return result && isApiError(result) ? { ...result, apiError: true } : result;
};

// A stalled fetch (a hung remote, a credential prompt) must not hang the restart loop.
export const COMPLETION_SYNC_TIMEOUT_MS = 5 * 60 * 1000;

/** Issue #1572 pattern: restart from the remote branch state; a failed or timed-out pull keeps the local state. */
export const syncCompletionBranch = async ({ tempDir, branchName, logger, timeoutMs = COMPLETION_SYNC_TIMEOUT_MS, env = process.env }) => {
  try {
    await promisify(execFile)('git', ['pull', 'origin', branchName], { cwd: tempDir, env, timeout: timeoutMs, killSignal: 'SIGKILL' });
  } catch (error) {
    await logger(`   Warning: git pull failed (${String(error.message).split('\n')[0]}); continuing with local state`, { level: 'warning' });
  }
};

export async function runIssueCompletionUntilVerified(params, { check = checkIssueCompletionBeforeMerge, execute = defaultExecute, sync = syncCompletionBranch, logger = async () => {}, limit = normalizeEnsureSubIssuesLimit(params.argv?.ensureAllSubIssuesAddressed) || DEFAULT_ISSUE_COMPLETION_RESTARTS } = {}) {
  if (!params.prNumber || !params.issueNumber || params.argv?.dryRun) return null;
  const { owner, repo, issueNumber, prNumber, argv = {} } = params;
  let latest = null;
  let verificationFailures = 0;
  let toolFailures = 0;
  let verification;
  for (let iteration = 0; ; iteration++) {
    verification = await check({ owner, repo, issueNumber, prNumber, logger, verbose: argv.verbose });
    const { blocker } = verification;
    if (!blocker || iteration >= limit) break;
    // Only honestly blocked work remains: a human has to unblock it.
    if (blocker.retryable === false) break;
    // Unreadable evidence cannot certify completion; stop after repeated failures.
    if (blocker.reason === 'issue_completion_verification_failed' || blocker.reason === 'issue_link_verification_failed') {
      if (++verificationFailures >= MAX_CONSECUTIVE_FAILURES) break;
    } else verificationFailures = 0;
    await logger(`🎯 Completion restart ${iteration + 1}/${limit}: ${blocker.message}`);
    if (params.tempDir && params.branchName) await sync({ tempDir: params.tempDir, branchName: params.branchName, logger });
    latest = await execute({ ...params, feedbackLines: [ISSUE_COMPLETION_GOAL, blocker.message, ...(blocker.details || []), blocker.resolution, 'Read all issue and review feedback again, complete the missing work in this same pull request, then refresh its requirements report after the final push.'], argv: { ...argv, promptEnsureAllRequirementsAreMet: true } });
    await params.cleanupClaudeFile?.(params.tempDir, params.branchName, null, argv);
    if (latest?.limitReached || latest?.errorInfo?.usageLimitReached) break;
    if (latest?.apiError || latest?.errorDuringExecution || latest?.success === false) {
      if (++toolFailures >= MAX_CONSECUTIVE_FAILURES) break;
    } else toolFailures = 0;
  }
  if (verification?.blocker) await logger(`🛑 Pull request remains unmerged: ${verification.blocker.message} ${(verification.blocker.details || []).join('; ')}`, { level: 'warning' });
  return latest ? { ...latest, completionBlocker: verification?.blocker || null } : null;
}
