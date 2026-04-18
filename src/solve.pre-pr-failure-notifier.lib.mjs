import { getTrackedToolCommentIds, postTrackedComment, SOLUTION_DRAFT_FAILED_MARKER } from './tool-comments.lib.mjs';

const truncate = (value, maxLength = 2000) => {
  const text = value === null || value === undefined ? '' : String(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 22)}\n... truncated ...`;
};

const fence = value => truncate(value || 'Unknown error').replaceAll('```', '` ` `');

export function shouldNotifyIssueAboutPrePullRequestFailure({ code, globalState }) {
  if (code === 0) return false;
  if (!globalState?.issueNumber || !globalState?.owner || !globalState?.repo) return false;
  if (globalState?.createdPR?.number) return false;
  if (globalState.prePullRequestFailureNotificationPosted || globalState.prePullRequestFailureNotificationInProgress) return false;
  return getTrackedToolCommentIds().size === 0;
}

export function buildPrePullRequestFailureComment({ reason, owner, repo, issueNumber, argv = {}, rawCommand = null, logAttachmentAttempted = false }) {
  const tool = argv.tool || 'claude';
  const modelLine = argv.model ? `\n- **Requested model**: \`${argv.model}\`` : '';
  const commandBlock = rawCommand
    ? `

### Command
\`\`\`bash
${fence(rawCommand)}
\`\`\``
    : '';
  const logLine = logAttachmentAttempted ? 'Log attachment was attempted but failed. Check the solver terminal log for the complete failure output.' : 'Logs were not attached because `--attach-logs` was not enabled.';

  return `## 🚨 ${SOLUTION_DRAFT_FAILED_MARKER}

The automated solver stopped before creating a pull request, so no PR was opened for this issue.

### Failure
- **Repository**: \`${owner}/${repo}\`
- **Issue**: #${issueNumber}
- **Tool**: \`${tool}\`${modelLine}

**Reason**
\`\`\`text
${fence(reason)}
\`\`\`${commandBlock}

${logLine}

Please resolve the reported problem and rerun the solve command.`;
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
