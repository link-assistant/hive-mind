import { getTrackedToolCommentIds, postTrackedComment, SOLUTION_DRAFT_FAILED_MARKER } from './tool-comments.lib.mjs';

export const FORK_DIVERGENCE_RESOLUTION_OPTION = '--allow-fork-divergence-resolution-using-force-push-with-lease';

const truncate = (value, maxLength = 2000) => {
  const text = value === null || value === undefined ? '' : String(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 22)}\n... truncated ...`;
};

const fence = value => truncate(value || 'Unknown error').replaceAll('```', '` ` `');

const isForkDivergenceFailure = reason => {
  const normalizedReason = String(reason || '').toLowerCase();
  return normalizedReason.includes('fork divergence') || (normalizedReason.includes('fork') && normalizedReason.includes('non-fast-forward')) || normalizedReason.includes('force-with-lease');
};

const extractUrlAfter = (reason, label) => {
  const match = String(reason || '').match(new RegExp(`${label}\\s+(https://github\\.com/[^\\s;]+)`, 'i'));
  return match ? match[1] : null;
};

const isPushRejectionFailure = reason => {
  const normalizedReason = String(reason || '').toLowerCase();
  return normalizedReason.includes('push rejected for ') || (normalizedReason.includes('failed to push') && normalizedReason.includes('github.com'));
};

export function buildPrePullRequestFailureActionSection(reason = '') {
  const normalizedReason = String(reason || '').toLowerCase();
  const isForkOrRecoveryFailure = normalizedReason.includes('fork') || normalizedReason.includes('auto-recovery') || normalizedReason.includes('repository setup');

  if (isForkDivergenceFailure(reason)) {
    return `### What you can do
- If the fork's default branch can be overwritten safely, rerun with \`${FORK_DIVERGENCE_RESOLUTION_OPTION}\` to allow a guarded force-with-lease sync.
- If the fork has commits you need to preserve, resolve the divergence manually, then rerun the solver.
- If this requires elevated Hive Mind access, ask a Hive Mind administrator to handle the affected fork or repository.

Administrator-only CLI details, if any, are printed in the solver terminal log rather than in this GitHub comment.`;
  }

  if (isPushRejectionFailure(reason)) {
    const branchUrl = extractUrlAfter(reason, 'inspect');
    const compareUrl = extractUrlAfter(reason, 'compare');
    return `### What you can do
- Inspect the remote branch${branchUrl ? `: ${branchUrl}` : ' named in the failure'}.
- Compare the base and head histories${compareUrl ? `: ${compareUrl}` : ' using the compare link named in the failure'}.
- If the branch belongs to you, merge the remote branch state or choose a new branch name, then rerun the solver.
- Do not force-push unless you have manually confirmed that overwriting the remote branch is safe.

Administrator-only CLI details, if any, are printed in the solver terminal log rather than in this GitHub comment.`;
  }

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

export function resolvePreExitFailureNotificationTarget({ code, globalState }) {
  if (code === 0) return null;
  if (!globalState?.owner || !globalState?.repo) return null;
  if (globalState.preExitFailureNotificationPosted || globalState.preExitFailureNotificationInProgress) return null;

  const owner = globalState.owner;
  const repo = globalState.repo;
  const issueNumber = globalState.issueNumber || null;
  const prNumber = globalState.createdPR?.number || globalState.prNumber || null;

  if (prNumber) {
    if (globalState.pullRequestFailureNotificationPosted || globalState.pullRequestFailureNotificationInProgress) return null;
    return {
      targetType: 'pr',
      targetNumber: prNumber,
      owner,
      repo,
      issueNumber,
      prNumber,
    };
  }

  if (!issueNumber) return null;
  if (globalState.prePullRequestFailureNotificationPosted || globalState.prePullRequestFailureNotificationInProgress) return null;
  if (getTrackedToolCommentIds().size !== 0) return null;

  return {
    targetType: 'issue',
    targetNumber: issueNumber,
    owner,
    repo,
    issueNumber,
    prNumber: null,
  };
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

export function buildExistingPullRequestFailureComment({ reason, owner, repo, prNumber, issueNumber = null, argv = {}, logAttachmentAttempted = false }) {
  const tool = argv.tool || 'claude';
  const modelLine = argv.model ? `\n- **Requested model**: \`${argv.model}\`` : '';
  const issueLine = issueNumber ? `\n- **Linked issue**: #${issueNumber}` : '';
  const logLine = logAttachmentAttempted ? 'Log attachment was attempted but failed. Check the solver terminal log for the complete failure output.' : 'Logs were not attached because `--attach-logs` was not enabled.';
  const actionSection = buildPrePullRequestFailureActionSection(reason);

  return `## 🚨 ${SOLUTION_DRAFT_FAILED_MARKER}

The automated solver stopped while continuing this existing pull request, so the failure details are posted here for review.

### Failure
- **Repository**: \`${owner}/${repo}\`
- **Pull request**: #${prNumber}${issueLine}
- **Tool**: \`${tool}\`${modelLine}

**Reason**
\`\`\`text
${fence(reason)}
\`\`\`

${actionSection}

${logLine}
`;
}

const markNotificationPosted = ({ globalState, targetType }) => {
  globalState.preExitFailureNotificationPosted = true;
  if (targetType === 'pr') {
    globalState.pullRequestFailureNotificationPosted = true;
  } else {
    globalState.prePullRequestFailureNotificationPosted = true;
  }
};

export async function notifyIssueAboutPrePullRequestFailure(options) {
  const { code, reason, argv = {}, globalState = globalThis, $, log = async () => {}, getLogFile, shouldAttachLogs = false, attachLogToGitHub, sanitizeLogContent, rawCommand = null, postComment = postTrackedComment } = options;

  const target = resolvePreExitFailureNotificationTarget({ code, globalState });
  if (!target) {
    return { notified: false, skipped: true };
  }

  const { owner, repo, issueNumber, prNumber, targetType, targetNumber } = target;
  const targetLabel = targetType === 'pr' ? `pull request #${targetNumber}` : `issue #${targetNumber}`;
  globalState.preExitFailureNotificationInProgress = true;
  if (targetType === 'pr') {
    globalState.pullRequestFailureNotificationInProgress = true;
  } else {
    globalState.prePullRequestFailureNotificationInProgress = true;
  }

  try {
    if (shouldAttachLogs && getLogFile && attachLogToGitHub && sanitizeLogContent) {
      await log(`\n📄 Notifying ${targetLabel} about solver failure with logs...`);
      const errorPrefix = targetType === 'pr' ? `The solver stopped while continuing pull request #${targetNumber}.` : 'The solver stopped before creating a pull request.';
      try {
        const uploaded = await attachLogToGitHub({
          logFile: getLogFile(),
          targetType,
          targetNumber,
          owner,
          repo,
          $,
          log,
          sanitizeLogContent,
          verbose: argv.verbose,
          errorMessage: `${errorPrefix}\n\nReason: ${reason || 'Unknown error'}`,
          failureActionSection: buildPrePullRequestFailureActionSection(reason),
          argv,
          requestedModel: argv.originalModel || argv.model,
          tool: argv.tool || 'claude',
        });
        if (uploaded) {
          markNotificationPosted({ globalState, targetType });
          return { notified: true, method: 'log-upload' };
        }
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        await log(`  ⚠️  Could not upload solver failure log: ${message}`, { level: 'warning' });
      }
    }

    await log(`\n💬 Notifying ${targetLabel} about solver failure...`);
    const body =
      targetType === 'pr'
        ? buildExistingPullRequestFailureComment({
            reason,
            owner,
            repo,
            prNumber,
            issueNumber,
            argv,
            rawCommand,
            logAttachmentAttempted: shouldAttachLogs,
          })
        : buildPrePullRequestFailureComment({
            reason,
            owner,
            repo,
            issueNumber,
            argv,
            rawCommand,
            logAttachmentAttempted: shouldAttachLogs,
          });
    const posted = await postComment({ $, owner, repo, targetNumber, body });
    if (posted.ok) {
      markNotificationPosted({ globalState, targetType });
      await log(`  ✅ Solver failure comment posted to ${targetLabel}${posted.commentId ? ` (id=${posted.commentId})` : ''}`);
      return { notified: true, method: 'comment', commentId: posted.commentId || null };
    }
    await log(`  ⚠️  Could not post solver failure comment: ${posted.stderr || 'unknown error'}`, { level: 'warning' });
    return { notified: false, error: posted.stderr || 'unknown error' };
  } finally {
    globalState.preExitFailureNotificationInProgress = false;
    if (targetType === 'pr') {
      globalState.pullRequestFailureNotificationInProgress = false;
    }
    globalState.prePullRequestFailureNotificationInProgress = false;
  }
}
