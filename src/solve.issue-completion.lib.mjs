/** Bounded completion retries shared by initial solves and later merge attempts. */
import { checkIssueCompletionBeforeMerge } from './issue-completion.lib.mjs';
import { repairRequiredIssueLinks } from './pr-issue-link-repair.lib.mjs';
import { DEFAULT_ENSURE_SUB_ISSUES_LIMIT, normalizeEnsureSubIssuesLimit } from './solve.ensure-sub-issues.detect.lib.mjs';
import { ISSUE_COMPLETION_GOAL } from './issue-completion.prompts.lib.mjs';

export async function runIssueCompletionUntilVerified(params, { check = checkIssueCompletionBeforeMerge, repair = repairRequiredIssueLinks, execute = async iteration => (await import('./solve.restart-shared.lib.mjs')).executeToolIteration(iteration), logger = async () => {}, limit = normalizeEnsureSubIssuesLimit(params.argv?.ensureAllSubIssuesAddressed ?? params.argv?.['ensure-all-sub-issues-addressed']) || DEFAULT_ENSURE_SUB_ISSUES_LIMIT } = {}) {
  if (!params.prNumber || !params.issueNumber) return null;
  let latest = null;
  let errors = 0;
  let toolErrors = 0;
  let verification;
  for (let iteration = 0; ; iteration++) {
    await repair({ ...params, logger });
    verification = await check({ ...params, logger, verbose: params.argv?.verbose });
    if (!verification.blocker || iteration >= limit) break;
    // API failures cannot certify completion. Stop bounded retries after three
    // consecutive failures; the independent merge guard remains mandatory.
    if (verification.blocker.reason === 'issue_completion_verification_failed') {
      errors++;
      if (errors >= 3) break;
    } else errors = 0;
    await logger(`🎯 Completion restart ${iteration + 1}/${limit}: ${verification.blocker.message}`);
    latest = await execute({ ...params, feedbackLines: [ISSUE_COMPLETION_GOAL, verification.blocker.message, ...verification.blocker.details, verification.blocker.resolution, 'Read all issue and review feedback again, complete the missing work in this same PR, then refresh its requirements report after the final push.'], argv: { ...params.argv, promptEnsureAllRequirementsAreMet: true } });
    await params.cleanupClaudeFile?.(params.tempDir, params.branchName, null, params.argv);
    if (latest?.limitReached || latest?.errorInfo?.usageLimitReached || latest?.errorInfo?.type === 'usage_limit') break;
    if (latest?.errorDuringExecution || latest?.success === false) {
      toolErrors++;
      if (toolErrors >= 3) break;
    } else toolErrors = 0;
  }
  if (verification?.blocker) await logger(`🛑 Pull request remains unmerged: ${verification.blocker.message} ${verification.blocker.details.join('; ')}`, { level: 'warning' });
  return latest ? { ...latest, completionBlocker: verification?.blocker || null } : null;
}
