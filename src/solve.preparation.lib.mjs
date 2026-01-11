/**
 * Pre-execution preparation functionality for solve.mjs
 * Handles timestamp collection, feedback detection, and pre-execution checks
 */

// Import feedback detection functionality
const feedback = await import('./solve.feedback.lib.mjs');
const { detectAndCountFeedback } = feedback;

export async function prepareFeedbackAndTimestamps({ prNumber, branchName: _branchName, owner, repo, issueNumber, isContinueMode: _isContinueMode, mergeStateStatus: _mergeStateStatus, prState: _prState, argv: _argv, log, formatAligned, cleanErrorMessage: _cleanErrorMessage, $ }) {
  // Count new comments and detect feedback
  let { feedbackLines } = await detectAndCountFeedback({
    prNumber,
    branchName: _branchName,
    owner,
    repo,
    issueNumber,
    isContinueMode: _isContinueMode,
    argv: _argv,
    mergeStateStatus: _mergeStateStatus,
    prState: _prState,
    workStartTime: null, // Will be set by session management
    log,
    formatAligned,
    cleanErrorMessage: _cleanErrorMessage,
    $,
  });

  // Get timestamps from GitHub servers before executing the command
  await log(`${formatAligned('📅', 'Getting timestamps:', 'From GitHub servers...')}`);

  let referenceTime;
  try {
    // Get the issue's last update time
    const issueResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber} --jq .updated_at`;

    if (issueResult.code !== 0) {
      throw new Error(`Failed to get issue details: ${issueResult.stderr ? issueResult.stderr.toString() : 'Unknown error'}`);
    }

    const issueUpdatedAt = new Date(issueResult.stdout.toString().trim());
    await log(formatAligned('📝', 'Issue updated:', issueUpdatedAt.toISOString(), 2));

    // Get the last comment's timestamp (if any)
    // Use --paginate to get all comments - GitHub API returns max 30 per page by default
    const commentsResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments --paginate`;

    if (commentsResult.code !== 0) {
      await log(`Warning: Failed to get comments: ${commentsResult.stderr ? commentsResult.stderr.toString() : 'Unknown error'}`, { level: 'warning' });
      // Continue anyway, comments are optional
    }

    const comments = JSON.parse(commentsResult.stdout.toString().trim() || '[]');
    const lastCommentTime = comments.length > 0 ? new Date(comments[comments.length - 1].created_at) : null;
    if (lastCommentTime) {
      await log(formatAligned('💬', 'Last comment:', lastCommentTime.toISOString(), 2));
    } else {
      await log(formatAligned('💬', 'Comments:', 'None found', 2));
    }

    // Get the most recent pull request's timestamp
    const prsResult = await $`gh pr list --repo ${owner}/${repo} --limit 1 --json createdAt`;

    if (prsResult.code !== 0) {
      await log(`Warning: Failed to get PRs: ${prsResult.stderr ? prsResult.stderr.toString() : 'Unknown error'}`, {
        level: 'warning',
      });
      // Continue anyway, PRs are optional for timestamp calculation
    }

    const prs = JSON.parse(prsResult.stdout.toString().trim() || '[]');
    const lastPrTime = prs.length > 0 ? new Date(prs[0].createdAt) : null;
    if (lastPrTime) {
      await log(formatAligned('🔀', 'Recent PR:', lastPrTime.toISOString(), 2));
    } else {
      await log(formatAligned('🔀', 'Pull requests:', 'None found', 2));
    }

    // Use the most recent timestamp as reference
    referenceTime = issueUpdatedAt;
    if (lastCommentTime && lastCommentTime > referenceTime) {
      referenceTime = lastCommentTime;
    }
    if (lastPrTime && lastPrTime > referenceTime) {
      referenceTime = lastPrTime;
    }

    await log(`\n${formatAligned('✅', 'Reference time:', referenceTime.toISOString())}`);
  } catch (timestampError) {
    const sentryLib = await import('./sentry.lib.mjs');
    const { reportError } = sentryLib;
    reportError(timestampError, {
      context: 'get_reference_timestamp',
      prNumber,
      issueNumber,
      operation: 'fetch_github_timestamps',
    });
    await log('Warning: Could not get GitHub timestamps, using current time as reference', { level: 'warning' });
    await log(`  Error: ${timestampError.message}`);
    referenceTime = new Date();
    await log(`  Fallback timestamp: ${referenceTime.toISOString()}`);
  }

  return { feedbackLines, referenceTime };
}

export async function checkUncommittedChanges({ tempDir, argv, log, $ }) {
  // Check for uncommitted changes before running Claude
  // Only add to feedback if auto-commit is disabled
  if (!argv['auto-commit-uncommitted-changes']) {
    await log('\n🔍 Checking for uncommitted changes to include as feedback...');
    try {
      const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
      if (gitStatusResult.code === 0) {
        const statusOutput = gitStatusResult.stdout.toString().trim();
        if (statusOutput) {
          await log('📝 Found uncommitted changes - adding to feedback');

          // Add uncommitted changes info to feedbackLines
          let feedbackLines = [];

          feedbackLines.push('');
          feedbackLines.push('⚠️ UNCOMMITTED CHANGES DETECTED:');
          feedbackLines.push('The following uncommitted changes were found in the repository:');
          feedbackLines.push('');

          for (const line of statusOutput.split('\n')) {
            feedbackLines.push(`  ${line}`);
          }

          feedbackLines.push('');
          feedbackLines.push('IMPORTANT: You MUST handle these uncommitted changes by either:');
          feedbackLines.push('1. COMMITTING them if they are part of the solution (git add + git commit + git push)');
          feedbackLines.push('2. REVERTING them if they are not needed (git checkout -- <file> or git clean -fd)');
          feedbackLines.push('');
          feedbackLines.push('DO NOT leave uncommitted changes behind. The session will auto-restart until all changes are resolved.');
          return feedbackLines;
        } else {
          await log('✅ No uncommitted changes found');
        }
      }
    } catch (gitError) {
      const sentryLib = await import('./sentry.lib.mjs');
      const { reportError } = sentryLib;
      reportError(gitError, {
        context: 'check_uncommitted_changes',
        tempDir,
        operation: 'git_status',
      });
      await log(`⚠️ Warning: Could not check git status: ${gitError.message}`, { level: 'warning' });
    }
  }
  return [];
}

export async function checkForkActions({ argv, forkedRepo, branchName, log, formatAligned, $ }) {
  // Check for GitHub Actions on fork repository if applicable
  let forkActionsUrl = null;
  if (argv.fork && forkedRepo) {
    try {
      // Get fork owner from forkedRepo (format: owner/repo)
      const forkOwner = forkedRepo.split('/')[0];
      const forkRepo = forkedRepo.split('/')[1];

      // Check if workflows directory exists in the fork
      const workflowsResult = await $`gh api repos/${forkOwner}/${forkRepo}/contents/.github/workflows --paginate --jq '.[].name' 2>/dev/null`;

      if (workflowsResult.code === 0) {
        const workflows = workflowsResult.stdout.toString().trim();
        if (workflows) {
          // Workflows exist, construct the actions URL for the branch
          forkActionsUrl = `https://github.com/${forkOwner}/${forkRepo}/actions?query=branch%3A${encodeURIComponent(branchName)}`;
          await log(`${formatAligned('📦', 'Fork workflows detected:', forkActionsUrl)}`);
        }
      }
    } catch {
      // No workflows or error checking - that's fine, forkActionsUrl stays null
      if (argv.verbose) {
        await log('No GitHub Actions workflows found on fork', { verbose: true });
      }
    }
  }

  return forkActionsUrl;
}
