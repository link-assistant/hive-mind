/**
 * Feedback detection module for solve.mjs
 * Handles comment counting and feedback detection for continue mode
 */

// Import Sentry integration
import { reportError } from './sentry.lib.mjs';

import { wrapDollarWithGhRetry as _wrapDollarWithGhRetry } from './github-rate-limit.lib.mjs'; // rate-limit marker (#1726): gh API calls flow through $ wrapped by caller
import { QUIET_PROBE, quietProbe } from './quiet-probe.lib.mjs'; // issue #2130: keep read-only probe payloads out of the attached log
// Issue #1827: tool-generated comments (markers + in-memory tracked IDs) must
// not count as feedback in watch/continue mode, mirroring checkForNonBotComments.
import { isToolGeneratedComment, isToolTrackedCommentId } from './tool-comments.lib.mjs';
import { detectExternalContentEdits, formatEditEvidence } from './description-edits.lib.mjs'; // issue #2293
export const detectAndCountFeedback = async params => {
  const { prNumber, branchName, owner, repo, issueNumber, isContinueMode, argv, mergeStateStatus, prState, workStartTime, log, formatAligned, cleanErrorMessage, $, repositoryPath = null } = params;

  let newPrComments = 0;
  let newPrReviewComments = 0;
  let newIssueComments = 0;
  let commentInfo = '';
  let feedbackLines = [];
  let currentUser = null;

  // Get current GitHub user to filter out own comments
  try {
    const userResult = await quietProbe($)`gh api user --jq .login`;
    if (userResult.code === 0) {
      currentUser = userResult.stdout.toString().trim();
      await log(formatAligned('👤', 'Current user:', currentUser, 2));
    }
  } catch (error) {
    reportError(error, {
      context: 'get_current_user',
      operation: 'gh_api_user',
    });
    await log('Warning: Could not get current GitHub user', { level: 'warning' });
  }

  // Debug logging to understand when comment counting doesn't run
  if (argv.verbose) {
    await log('\n📊 Comment counting conditions:', { verbose: true });
    await log(`   prNumber: ${prNumber || 'NOT SET'}`, { verbose: true });
    await log(`   branchName: ${branchName || 'NOT SET'}`, { verbose: true });
    await log(`   isContinueMode: ${isContinueMode}`, { verbose: true });
    await log(`   Will count comments: ${!!(prNumber && branchName)}`, { verbose: true });
    if (!prNumber) {
      await log('   ⚠️  Skipping: prNumber not set', { verbose: true });
    }
    if (!branchName) {
      await log('   ⚠️  Skipping: branchName not set', { verbose: true });
    }
  }

  if (prNumber && branchName) {
    try {
      await log(`${formatAligned('💬', 'Counting comments:', 'Checking for new comments since last commit...')}`);
      if (argv.verbose) {
        await log(`   PR #${prNumber} on branch: ${branchName}`, { verbose: true });
        await log(`   Owner/Repo: ${owner}/${repo}`, { verbose: true });
        if (repositoryPath) {
          await log(`   Repository path: ${repositoryPath}`, { verbose: true });
        }
      }

      // Get the last commit timestamp from the PR branch
      let lastCommitTime = null;
      // Issue #2130: quiet. These probes answer "when was the last commit?", and
      // the answer is logged in words below; mirroring them put bare ISO dates
      // and `git log`'s "unknown revision" complaint - the expected outcome for
      // a branch that has never been pushed - into the attached log.
      const git$ = repositoryPath ? $({ cwd: repositoryPath, ...QUIET_PROBE }) : quietProbe($);
      let lastCommitResult = await git$`git log -1 --format="%aI" origin/${branchName}`;
      if (lastCommitResult.code !== 0) {
        // Fallback to local branch if remote doesn't exist
        lastCommitResult = await git$`git log -1 --format="%aI" ${branchName}`;
      }

      if (lastCommitResult.code === 0) {
        lastCommitTime = new Date(lastCommitResult.stdout.toString().trim());
        await log(formatAligned('📅', 'Last commit time:', lastCommitTime.toISOString(), 2));
      } else {
        // Fallback: Get last commit time from GitHub API
        try {
          const prCommitsResult = await quietProbe($)`gh api repos/${owner}/${repo}/pulls/${prNumber}/commits --paginate --jq 'last.commit.author.date'`;
          if (prCommitsResult.code === 0 && prCommitsResult.stdout?.toString()) {
            lastCommitTime = new Date(prCommitsResult.stdout.toString().trim());
            await log(formatAligned('📅', 'Last commit time (from API):', lastCommitTime.toISOString(), 2));
          }
        } catch (error) {
          reportError(error, {
            context: 'get_last_commit_time',
            prNumber,
            operation: 'fetch_commit_timestamp',
          });
          await log(`Warning: Could not get last commit time: ${cleanErrorMessage(error)}`, { level: 'warning' });
        }
      }

      // Only proceed if we have a last commit time
      if (lastCommitTime) {
        // Define log patterns to filter out comments containing logs from solve.mjs
        const logPatterns = [/📊.*Log file|solution\s+draft.*log/i, /🔗.*Link:|💻.*Session:/i, /Generated with.*solve\.mjs/i, /Session ID:|Log file available:/i];

        // Issue #1827: A comment is tool-generated if its ID was tracked in
        // memory during this run (system status comments AND the agent's own
        // session comments) or if its body carries a known tool marker (catches
        // comments from previous runs whose IDs are gone). These must never
        // count as feedback — otherwise the agent's own "CI now green" / status
        // comments trigger an endless restart loop (see PR link-foundation/rust-web-box#34).
        const isToolComment = comment => isToolTrackedCommentId(comment.id) || isToolGeneratedComment(comment.body);

        // Count new PR comments after last commit (both code review comments and conversation comments)
        let prReviewComments = [];
        let prConversationComments = [];

        // Get PR code review comments (use --paginate to get all comments, not just first page)
        const prReviewCommentsResult = await quietProbe($)`gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --paginate`;
        if (prReviewCommentsResult.code === 0) {
          prReviewComments = JSON.parse(prReviewCommentsResult.stdout.toString());
        }

        // Get PR conversation comments (PR is also an issue)
        // Use --paginate to get all comments - GitHub API returns max 30 per page by default
        const prConversationCommentsResult = await quietProbe($)`gh api repos/${owner}/${repo}/issues/${prNumber}/comments --paginate`;
        if (prConversationCommentsResult.code === 0) {
          prConversationComments = JSON.parse(prConversationCommentsResult.stdout.toString());
        }

        // Helper function to filter comments based on time and log patterns
        const filterComment = comment => {
          // Issue #1827: never count tool-generated comments as feedback.
          if (isToolComment(comment)) {
            return false;
          }
          const commentTime = new Date(comment.created_at);
          const isAfterCommit = commentTime > lastCommitTime;
          const isNotLogPattern = !logPatterns.some(pattern => pattern.test(comment.body || ''));

          // If we have a work start time and current user, filter out comments made by claude tool after work started
          if (workStartTime && currentUser && comment.user && comment.user.login === currentUser) {
            const isAfterWorkStart = commentTime > new Date(workStartTime);
            if (isAfterWorkStart && argv.verbose) {
              // Note: Filtering out own comment from user after work started
            }
            return isAfterCommit && !isAfterWorkStart && isNotLogPattern;
          }

          return isAfterCommit && isNotLogPattern;
        };

        // Filter and count PR review comments (inline code comments) separately
        const filteredPrReviewComments = prReviewComments.filter(filterComment);
        newPrReviewComments = filteredPrReviewComments.length;

        // Filter and count PR conversation comments separately
        const filteredPrConversationComments = prConversationComments.filter(filterComment);
        newPrComments = filteredPrConversationComments.length;

        // Combined count for logging purposes
        const allPrComments = [...prReviewComments, ...prConversationComments];

        // Count new issue comments after last commit
        // Use --paginate to get all comments - GitHub API returns max 30 per page by default
        const issueCommentsResult = await quietProbe($)`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments --paginate`;
        if (issueCommentsResult.code === 0) {
          const issueComments = JSON.parse(issueCommentsResult.stdout.toString());
          const filteredIssueComments = issueComments.filter(comment => {
            // Issue #1827: never count tool-generated comments as feedback.
            if (isToolComment(comment)) {
              return false;
            }
            const commentTime = new Date(comment.created_at);
            const isAfterCommit = commentTime > lastCommitTime;
            const isNotLogPattern = !logPatterns.some(pattern => pattern.test(comment.body || ''));

            // If we have a work start time and current user, filter out comments made by claude tool after work started
            if (workStartTime && currentUser && comment.user && comment.user.login === currentUser) {
              const isAfterWorkStart = commentTime > new Date(workStartTime);
              if (isAfterWorkStart && argv.verbose) {
                // Note: Filtering out own issue comment from user after work started
              }
              return isAfterCommit && !isAfterWorkStart && isNotLogPattern;
            }

            return isAfterCommit && isNotLogPattern;
          });
          newIssueComments = filteredIssueComments.length;
        }

        await log(formatAligned('💬', 'New PR comments:', newPrComments.toString(), 2));
        await log(formatAligned('💬', 'New PR review comments:', newPrReviewComments.toString(), 2));
        await log(formatAligned('💬', 'New issue comments:', newIssueComments.toString(), 2));

        if (argv.verbose) {
          await log(`   Total new comments: ${newPrComments + newPrReviewComments + newIssueComments}`, { verbose: true });
          await log(`   Comment lines to add: ${newPrComments > 0 || newPrReviewComments > 0 || newIssueComments > 0 ? 'Yes' : 'No (saving tokens)'}`, { verbose: true });
          await log(`   PR review comments fetched: ${prReviewComments.length}`, { verbose: true });
          await log(`   PR conversation comments fetched: ${prConversationComments.length}`, { verbose: true });
          await log(`   Total PR comments checked: ${allPrComments.length}`, { verbose: true });
        }

        // Check if --auto-continue-only-on-new-comments is enabled and fail if no new comments
        if (argv.autoContinueOnlyOnNewComments && (isContinueMode || argv.autoContinue)) {
          const totalNewComments = newPrComments + newPrReviewComments + newIssueComments;
          if (totalNewComments === 0) {
            await log('❌ auto-continue-only-on-new-comments: No new comments found since last commit');
            await log('   This option requires new comments to proceed with auto-continue or continue mode.');
            process.exit(1);
          } else {
            await log(`✅ auto-continue-only-on-new-comments: Found ${totalNewComments} new comments, continuing...`);
          }
        }

        // Build comprehensive feedback info for system prompt
        feedbackLines = []; // Reset for this execution
        let feedbackDetected = false;
        const feedbackSources = [];

        // Add comment info if counts are > 0 to avoid wasting tokens
        if (newPrComments > 0) {
          feedbackLines.push(`New comments on the pull request: ${newPrComments}`);
        }
        if (newPrReviewComments > 0) {
          feedbackLines.push(`New review comments on the pull request: ${newPrReviewComments}`);
        }
        if (newIssueComments > 0) {
          feedbackLines.push(`New comments on the issue: ${newIssueComments}`);
        }

        // Enhanced feedback detection for all continue modes
        if (isContinueMode || argv.autoContinue) {
          if (argv.continueOnlyOnFeedback) {
            await log(`${formatAligned('🔍', 'Feedback detection:', 'Checking for any feedback since last commit...')}`);
          }

          // 1. Check for new comments (already filtered above)
          const totalNewComments = newPrComments + newPrReviewComments + newIssueComments;
          if (totalNewComments > 0) {
            feedbackDetected = true;
            feedbackSources.push(`New comments (${totalNewComments})`);
          }

          // 2. Check for edited titles/descriptions
          // Issue #895: edits made during the current work session are the agent's own.
          // Issue #2293: `updated_at` is bumped by comments, labels and cross-references,
          // and most real edits were made by earlier solver sessions (same account), so
          // both produced false "description was edited" restarts. Read the actual edit
          // history instead, ignore edits made inside the solver's own sessions, and log
          // evidence (timestamp, editor, diff excerpt) for every edit that is reported.
          try {
            const editTargets = [{ kind: 'pr', number: prNumber, label: 'Pull request', source: 'PR description edited' }];
            if (issueNumber && Number(issueNumber) !== Number(prNumber)) {
              editTargets.push({ kind: 'issue', number: issueNumber, label: 'Issue', source: 'Issue description edited' });
            } else if (issueNumber && argv.verbose) {
              await log('   Note: No separate linked issue (issue number equals PR number) - checking PR edits only', { verbose: true });
            }
            // Solver session windows come from the PR's comments; the PR's creation opens the first one.
            let prCreatedAt = null;
            for (const target of editTargets) {
              const detection = await detectExternalContentEdits({
                owner,
                repo,
                number: target.number,
                since: lastCommitTime,
                until: workStartTime,
                comments: prConversationComments,
                currentUser,
                openedAt: target.kind === 'pr' ? undefined : prCreatedAt,
                $: quietProbe($),
              });
              if (target.kind === 'pr' && detection.ok) prCreatedAt = detection.createdAt;
              if (!detection.ok) {
                if (argv.verbose) {
                  await log(`   Warning: Could not read edit history of #${target.number}: ${detection.error}`, { verbose: true });
                }
                continue;
              }
              if (argv.verbose) {
                for (const { edit, reason } of detection.ignored) {
                  await log(`   Ignored ${target.kind === 'pr' ? 'PR' : 'issue'} #${target.number} ${formatEditEvidence(edit)} - ${reason}`, { verbose: true });
                }
              }
              if (detection.external.length === 0) continue;
              const fields = [...new Set(detection.external.map(edit => (edit.field === 'title' ? 'title' : 'description')))].join(' and ');
              feedbackLines.push(`${target.label} ${fields} was edited after last commit:`);
              for (const edit of detection.external) {
                const evidence = formatEditEvidence(edit);
                feedbackLines.push(`  - ${evidence}`);
                await log(`   ✏️  ${target.label} #${target.number} ${evidence}`);
              }
              feedbackDetected = true;
              feedbackSources.push(target.source);
            }
          } catch (error) {
            reportError(error, {
              context: 'check_description_edits',
              prNumber,
              operation: 'fetch_content_edits',
            });
            if (argv.verbose) {
              await log(`Warning: Could not check description edits: ${cleanErrorMessage(error)}`, {
                level: 'warning',
              });
            }
          }

          // 3. Check for new commits on default branch
          try {
            const defaultBranchResult = await quietProbe($)`gh api repos/${owner}/${repo}`;
            if (defaultBranchResult.code === 0) {
              const repoData = JSON.parse(defaultBranchResult.stdout.toString());
              const defaultBranch = repoData.default_branch;

              const commitsResult = await quietProbe($)`gh api repos/${owner}/${repo}/commits --paginate --field sha=${defaultBranch} --field since=${lastCommitTime.toISOString()}`;
              if (commitsResult.code === 0) {
                const commits = JSON.parse(commitsResult.stdout.toString());
                if (commits.length > 0) {
                  feedbackLines.push(`New commits on ${defaultBranch} branch: ${commits.length}`);
                  feedbackDetected = true;
                  feedbackSources.push(`New commits on ${defaultBranch} (${commits.length})`);
                }
              }
            }
          } catch (error) {
            reportError(error, {
              context: 'check_branch_commits',
              branchName,
              operation: 'fetch_commit_messages',
            });
            if (argv.verbose) {
              await log(`Warning: Could not check default branch commits: ${cleanErrorMessage(error)}`, {
                level: 'warning',
              });
            }
          }

          // 4. Check pull request state (non-open indicates closed or merged)
          if (prState && prState !== 'OPEN') {
            feedbackLines.push(`Pull request state: ${prState}`);
            feedbackDetected = true;
            feedbackSources.push(`PR state ${prState}`);
          }

          // 5. Check merge status (non-clean indicates issues with merging)
          if (mergeStateStatus && mergeStateStatus !== 'CLEAN') {
            const statusDescriptions = {
              DIRTY: 'Merge status is DIRTY (conflicts detected)',
              UNSTABLE: 'Merge status is UNSTABLE (non-passing commit status)',
              BLOCKED: 'Merge status is BLOCKED',
              BEHIND: 'Merge status is BEHIND (head ref is out of date)',
              HAS_HOOKS: 'Merge status is HAS_HOOKS (has pre-receive hooks)',
              UNKNOWN: 'Merge status is UNKNOWN',
            };
            const description = statusDescriptions[mergeStateStatus] || `Merge status is ${mergeStateStatus}`;
            feedbackLines.push(description);
            feedbackDetected = true;
            feedbackSources.push(`Merge status ${mergeStateStatus}`);
          }

          // 6. Check for failed PR checks
          try {
            const prHeadResult = await quietProbe($)`gh api repos/${owner}/${repo}/pulls/${prNumber} --jq '.head.sha'`;
            if (prHeadResult.code === 0) {
              const prHeadSha = prHeadResult.stdout.toString().trim();
              const checksResult = await quietProbe($)`gh api repos/${owner}/${repo}/commits/${prHeadSha}/check-runs --paginate --slurp`;
              const checkRuns = checksResult.code === 0 ? JSON.parse(checksResult.stdout.toString() || '[]').flatMap(page => page.check_runs || []) : [];
              const failedChecks = checkRuns.filter(check => check.conclusion === 'failure' && new Date(check.completed_at) > lastCommitTime);

              if (failedChecks.length > 0) {
                feedbackLines.push(`Failed pull request checks: ${failedChecks.length}`);
                feedbackDetected = true;
                feedbackSources.push(`Failed PR checks (${failedChecks.length})`);
              }
            }
          } catch (error) {
            reportError(error, {
              context: 'check_pr_status_checks',
              prNumber,
              operation: 'fetch_status_checks',
            });
            if (argv.verbose) {
              await log(`Warning: Could not check PR status checks: ${cleanErrorMessage(error)}`, { level: 'warning' });
            }
          }

          // 7. Check for review requests with changes requested
          try {
            const reviewsResult = await quietProbe($)`gh api repos/${owner}/${repo}/pulls/${prNumber}/reviews --paginate`;
            if (reviewsResult.code === 0) {
              const reviews = JSON.parse(reviewsResult.stdout.toString());
              const changesRequestedReviews = reviews.filter(review => review.state === 'CHANGES_REQUESTED' && new Date(review.submitted_at) > lastCommitTime);

              if (changesRequestedReviews.length > 0) {
                feedbackLines.push(`Changes requested in reviews: ${changesRequestedReviews.length}`);
                feedbackDetected = true;
                feedbackSources.push(`Changes requested (${changesRequestedReviews.length})`);
              }
            }
          } catch (error) {
            reportError(error, {
              context: 'check_pr_reviews',
              prNumber,
              operation: 'fetch_pr_reviews',
            });
            if (argv.verbose) {
              await log(`Warning: Could not check PR reviews: ${cleanErrorMessage(error)}`, { level: 'warning' });
            }
          }

          // Handle --continue-only-on-feedback option
          if (argv.continueOnlyOnFeedback) {
            if (feedbackDetected) {
              await log('✅ continue-only-on-feedback: Feedback detected, continuing...');
              await log(formatAligned('📋', 'Feedback sources:', feedbackSources.join(', '), 2));
            } else {
              await log('❌ continue-only-on-feedback: No feedback detected since last commit');
              await log('   This option requires any of the following to proceed:');
              await log('   • New comments (excluding solve.mjs logs)');
              await log('   • Edited issue/PR descriptions');
              await log('   • New commits on default branch');
              await log('   • Pull request state is not OPEN (closed or merged)');
              await log('   • Merge status is not CLEAN (conflicts, unstable, blocked, etc.)');
              await log('   • Failed pull request checks');
              await log('   • Changes requested via review');
              process.exit(1);
            }
          }
        }

        if (feedbackLines.length > 0) {
          commentInfo = '\n\n' + feedbackLines.join('\n') + '\n';
          if (argv.verbose) {
            await log('   Feedback info will be added to prompt:', { verbose: true });
            feedbackLines.forEach(async line => {
              await log(`     - ${line}`, { verbose: true });
            });
          }
        } else if (argv.verbose) {
          await log('   No feedback info to add (0 new items, saving tokens)', { verbose: true });
        }
      } else {
        await log('Warning: Could not determine last commit time, skipping comment counting', { level: 'warning' });
      }
    } catch (error) {
      reportError(error, {
        context: 'count_new_comments',
        prNumber,
        operation: 'detect_and_count_feedback',
      });
      await log(`Warning: Could not count new comments: ${cleanErrorMessage(error)}`, { level: 'warning' });
    }
  } else {
    await log(formatAligned('⚠️', 'Skipping comment count:', prNumber ? 'branchName not set' : 'prNumber not set', 2));
    if (argv.verbose) {
      await log(`   prNumber: ${prNumber || 'NOT SET'}`, { verbose: true });
      await log(`   branchName: ${branchName || 'NOT SET'}`, { verbose: true });
      await log('   This means no new comment detection will run', { verbose: true });
    }
  }

  return { newPrComments, newPrReviewComments, newIssueComments, commentInfo, feedbackLines };
};
