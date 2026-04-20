import { getTrackedToolCommentIds, postTrackedComment, SOLUTION_DRAFT_FAILED_MARKER } from './tool-comments.lib.mjs';

const truncate = (value, maxLength = 2000) => {
  const text = value === null || value === undefined ? '' : String(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 22)}\n... truncated ...`;
};

const fence = value => truncate(value || 'Unknown error').replaceAll('```', '` ` `');

export function buildPrePullRequestFailureActionSection(reason = '') {
  const normalizedReason = String(reason || '').toLowerCase();
  const isForkOrRecoveryFailure = normalizedReason.includes('fork') || normalizedReason.includes('auto-recovery') || normalizedReason.includes('repository setup');

  if (isForkOrRecoveryFailure) {
    return `### What you can do
- If the affected fork or repository belongs to you, remove, rename, archive, initialize, or otherwise repair it in GitHub, then rerun the solver.
- If the action requires elevated Hive Mind access, ask a Hive Mind administrator to handle the affected fork or repository and rerun the solver.
- Repository deletion can require a separate GitHub account or token with repository deletion permission; Hive Mind does not rely on that permission by default.

Administrator-only CLI details, if any, are printed in the solver terminal log rather than in this issue comment.`;
  }

  return `### What you can do
- Resolve the repository, account, permissions, or environment problem described above, then rerun the solver.
- If this requires elevated Hive Mind access, ask a Hive Mind administrator to handle the specific failure described above.

Administrator-only CLI details, if any, are printed in the solver terminal log rather than in this issue comment.`;
}

export function shouldNotifyIssueAboutPrePullRequestFailure({ code, globalState }) {
  if (code === 0) return false;
  if (!globalState?.issueNumber || !globalState?.owner || !globalState?.repo) return false;
  if (globalState?.createdPR?.number) return false;
  if (globalState.prePullRequestFailureNotificationPosted || globalState.prePullRequestFailureNotificationInProgress) return false;
  return getTrackedToolCommentIds().size === 0;
}

export function buildPrePullRequestFailureComment({ reason, owner, repo, issueNumber, argv = {}, logAttachmentAttempted = false }) {
  const tool = argv.tool || 'claude';
  const modelLine = argv.model ? `\n- **Requested model**: \`${argv.model}\`` : '';
  const logLine = logAttachmentAttempted ? 'Log attachment was attempted but failed. Check the solver terminal log for the complete failure output.' : 'Logs were not attached because `--attach-logs` was not enabled.';
  const actionSection = buildPrePullRequestFailureActionSection(reason);

  return `## 🚨 ${SOLUTION_DRAFT_FAILED_MARKER}

The automated solver stopped before creating a pull request, so no PR was opened for this issue.

### Failure
- **Repository**: \`${owner}/${repo}\`
- **Issue**: #${issueNumber}
- **Tool**: \`${tool}\`${modelLine}

**Reason**
\`\`\`text
${fence(reason)}
\`\`\`

${actionSection}

${logLine}
`;
}

export async function notifyIssueAboutPrePullRequestFailure(options) {
  const { code, reason, argv = {}, globalState = globalThis, $, log = async () => {}, getLogFile, shouldAttachLogs = false, attachLogToGitHub, sanitizeLogContent, rawCommand = null, postComment = postTrackedComment } = options;

  if (!shouldNotifyIssueAboutPrePullRequestFailure({ code, globalState })) {
    return { notified: false, skipped: true };
  }

  const owner = globalState.owner;
  const repo = globalState.repo;
  const issueNumber = globalState.issueNumber;
  globalState.prePullRequestFailureNotificationInProgress = true;

  try {
    if (shouldAttachLogs && getLogFile && attachLogToGitHub && sanitizeLogContent) {
      await log(`\n📄 Notifying issue #${issueNumber} about pre-PR failure with logs...`);
      const uploaded = await attachLogToGitHub({
        logFile: getLogFile(),
        targetType: 'issue',
        targetNumber: issueNumber,
        owner,
        repo,
        $,
        log,
        sanitizeLogContent,
        verbose: argv.verbose,
        errorMessage: `The solver stopped before creating a pull request.\n\nReason: ${reason || 'Unknown error'}`,
        requestedModel: argv.model,
        tool: argv.tool || 'claude',
      });
      if (uploaded) {
        globalState.prePullRequestFailureNotificationPosted = true;
        return { notified: true, method: 'log-upload' };
      }
    }

    await log(`\n💬 Notifying issue #${issueNumber} about pre-PR failure...`);
    const body = buildPrePullRequestFailureComment({
      reason,
      owner,
      repo,
      issueNumber,
      argv,
      rawCommand,
      logAttachmentAttempted: shouldAttachLogs,
    });
    const posted = await postComment({ $, owner, repo, targetNumber: issueNumber, body });
    if (posted.ok) {
      globalState.prePullRequestFailureNotificationPosted = true;
      await log(`  ✅ Pre-PR failure comment posted to issue #${issueNumber}${posted.commentId ? ` (id=${posted.commentId})` : ''}`);
      return { notified: true, method: 'comment', commentId: posted.commentId || null };
    }
    await log(`  ⚠️  Could not post pre-PR failure comment: ${posted.stderr || 'unknown error'}`, { level: 'warning' });
    return { notified: false, error: posted.stderr || 'unknown error' };
  } finally {
    globalState.prePullRequestFailureNotificationInProgress = false;
  }
}
