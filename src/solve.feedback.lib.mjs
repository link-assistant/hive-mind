/**
 * Feedback detection module for solve.mjs
 * Handles comment counting and feedback detection for continue mode
 */

// Import Sentry integration
import { reportError } from './sentry.lib.mjs';

export const detectAndCountFeedback = async params => {
  const {
    prNumber,
    branchName,
    owner,
    repo,
    issueNumber,
    isContinueMode,
    argv,
    mergeStateStatus,
    prState,
    workStartTime,
    log,
    formatAligned,
    cleanErrorMessage,
    $
  } = params;

  let newPrComments = 0;
  let newIssueComments = 0;
  let commentInfo = '';
  let feedbackLines = [];
  let currentUser = null;

  // Get current GitHub user to filter out own comments
  try {
    const userResult = await $`gh api user --jq .login`;
    if (userResult.code === 0) {
      currentUser = userResult.stdout.toString().trim();
      await log(formatAligned('👤', 'Current user:', currentUser, 2));
    }
  } catch (error) {
    reportError(error, {
      context: 'get_current_user',
      operation: 'gh_api_user'
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
      }

      // Get the last commit timestamp from the PR branch
      let lastCommitTime = null;
      let lastCommitResult = await $`git log -1 --format="%aI" origin/${branchName}`;
      if (lastCommitResult.code !== 0) {
        // Fallback to local branch if remote doesn't exist
        lastCommitResult = await $`git log -1 --format="%aI" ${branchName}`;
      }

      if (lastCommitResult.code === 0) {
        lastCommitTime = new Date(lastCommitResult.stdout.toString().trim());
        await log(formatAligned('📅', 'Last commit time:', lastCommitTime.toISOString(), 2));
      } else {
        // Fallback: Get last commit time from GitHub API
        try {
          const prCommitsResult =
            await $`gh api repos/${owner}/${repo}/pulls/${prNumber}/commits --jq 'last.commit.author.date'`;
          if (prCommitsResult.code === 0 && prCommitsResult.stdout) {
            lastCommitTime = new Date(prCommitsResult.stdout.toString().trim());
            await log(formatAligned('📅', 'Last commit time (from API):', lastCommitTime.toISOString(), 2));
          }
        } catch (error) {
          reportError(error, {
            context: 'get_last_commit_time',
            prNumber,
            operation: 'fetch_commit_timestamp'
          });
          await log(`Warning: Could not get last commit time: ${cleanErrorMessage(error)}`, { level: 'warning' });
        }
      }

      // Only proceed if we have a last commit time
      if (lastCommitTime) {
        // Define log patterns to filter out comments containing logs from solve.mjs
        const logPatterns = [
          /📊.*Log file|solution\s+draft.*log/i,
          /🔗.*Link:|💻.*Session:/i,
          /Generated with.*solve\.mjs/i,
          /Session ID:|Log file available:/i
        ];

        // Count new PR comments after last commit (both code review comments and conversation comments)
        let prReviewComments = [];
        let prConversationComments = [];

        // Get PR code review comments
        const prReviewCommentsResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber}/comments`;
        if (prReviewCommentsResult.code === 0) {
          prReviewComments = JSON.parse(prReviewCommentsResult.stdout.toString());
        }

        // Get PR conversation comments (PR is also an issue)
        const prConversationCommentsResult = await $`gh api repos/${owner}/${repo}/issues/${prNumber}/comments`;
        if (prConversationCommentsResult.code === 0) {
          prConversationComments = JSON.parse(prConversationCommentsResult.stdout.toString());
        }

        // Combine and count all PR comments after last commit
        // Filter out comments from current user if made after work started AND filter out log comments
        const allPrComments = [...prReviewComments, ...prConversationComments];
        const filteredPrComments = allPrComments.filter(comment => {
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
        });
        newPrComments = filteredPrComments.length;

        // Count new issue comments after last commit
        const issueCommentsResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments`;
        if (issueCommentsResult.code === 0) {
          const issueComments = JSON.parse(issueCommentsResult.stdout.toString());
          const filteredIssueComments = issueComments.filter(comment => {
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
        await log(formatAligned('💬', 'New issue comments:', newIssueComments.toString(), 2));

        if (argv.verbose) {
          await log(`   Total new comments: ${newPrComments + newIssueComments}`, { verbose: true });
          await log(
            `   Comment lines to add: ${newPrComments > 0 || newIssueComments > 0 ? 'Yes' : 'No (saving tokens)'}`,
            { verbose: true }
          );
          await log(`   PR review comments fetched: ${prReviewComments.length}`, { verbose: true });
          await log(`   PR conversation comments fetched: ${prConversationComments.length}`, { verbose: true });
          await log(`   Total PR comments checked: ${allPrComments.length}`, { verbose: true });
        }

        // Check if --auto-continue-only-on-new-comments is enabled and fail if no new comments
        if (argv.autoContinueOnlyOnNewComments && (isContinueMode || argv.autoContinue)) {
          const totalNewComments = newPrComments + newIssueComments;
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
        if (newIssueComments > 0) {
          feedbackLines.push(`New comments on the issue: ${newIssueComments}`);
        }

        // Enhanced feedback detection for all continue modes
        if (isContinueMode || argv.autoContinue) {
          if (argv.continueOnlyOnFeedback) {
            await log(
              `${formatAligned('🔍', 'Feedback detection:', 'Checking for any feedback since last commit...')}`
            );
          }

          // 1. Check for new comments (already filtered above)
          const totalNewComments = newPrComments + newIssueComments;
          if (totalNewComments > 0) {
            feedbackDetected = true;
            feedbackSources.push(`New comments (${totalNewComments})`);
          }

          // 2. Check for edited descriptions
          // Issue #895: Filter out edits made during current work session to prevent
          // infinite restart loops. When the agent updates the PR description as part of
          // its work, this should not trigger a restart. Only external edits (before work
          // started) should be considered feedback.
          try {
            // Check PR description edit time
            const prDetailsResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber}`;
            if (prDetailsResult.code === 0) {
              const prDetails = JSON.parse(prDetailsResult.stdout.toString());
              const prUpdatedAt = new Date(prDetails.updated_at);
              if (prUpdatedAt > lastCommitTime) {
                // Issue #895: Check if the edit happened during current work session
                // If the PR was updated after work started, it's likely the agent's own edit
                if (workStartTime && prUpdatedAt > new Date(workStartTime)) {
                  if (argv.verbose) {
                    await log(
                      '   Note: PR description updated during current work session (likely by agent itself) - ignoring',
                      { verbose: true }
                    );
                  }
                  // Don't treat this as external feedback
                } else {
                  // The PR was updated after last commit but before work started - external feedback
                  feedbackLines.push('Pull request description was edited after last commit');
                  feedbackDetected = true;
                  feedbackSources.push('PR description edited');
                }
              }
            }

            // Check issue description edit time if we have an issue
            if (issueNumber) {
              const issueDetailsResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}`;
              if (issueDetailsResult.code === 0) {
                const issueDetails = JSON.parse(issueDetailsResult.stdout.toString());
                const issueUpdatedAt = new Date(issueDetails.updated_at);
                if (issueUpdatedAt > lastCommitTime) {
                  // Issue #895: Check if the edit happened during current work session
                  if (workStartTime && issueUpdatedAt > new Date(workStartTime)) {
                    if (argv.verbose) {
                      await log(
                        '   Note: Issue description updated during current work session (likely by agent itself) - ignoring',
                        { verbose: true }
                      );
                    }
                    // Don't treat this as external feedback
                  } else {
                    // The issue was updated after last commit but before work started - external feedback
                    feedbackLines.push('Issue description was edited after last commit');
                    feedbackDetected = true;
                    feedbackSources.push('Issue description edited');
                  }
                }
              }
            }
          } catch (error) {
            reportError(error, {
              context: 'check_description_edits',
              prNumber,
              operation: 'fetch_pr_timeline'
            });
            if (argv.verbose) {
              await log(`Warning: Could not check description edit times: ${cleanErrorMessage(error)}`, {
                level: 'warning'
              });
            }
          }

          // 3. Check for new commits on default branch
          try {
            const defaultBranchResult = await $`gh api repos/${owner}/${repo}`;
            if (defaultBranchResult.code === 0) {
              const repoData = JSON.parse(defaultBranchResult.stdout.toString());
              const defaultBranch = repoData.default_branch;

              const commitsResult =
                await $`gh api repos/${owner}/${repo}/commits --field sha=${defaultBranch} --field since=${lastCommitTime.toISOString()}`;
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
              operation: 'fetch_commit_messages'
            });
            if (argv.verbose) {
              await log(`Warning: Could not check default branch commits: ${cleanErrorMessage(error)}`, {
                level: 'warning'
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
              UNKNOWN: 'Merge status is UNKNOWN'
            };
            const description = statusDescriptions[mergeStateStatus] || `Merge status is ${mergeStateStatus}`;
            feedbackLines.push(description);
            feedbackDetected = true;
            feedbackSources.push(`Merge status ${mergeStateStatus}`);
          }

          // 6. Check for failed PR checks
          try {
            const checksResult =
              await $`gh api repos/${owner}/${repo}/commits/$(gh api repos/${owner}/${repo}/pulls/${prNumber} --jq '.head.sha')/check-runs`;
            if (checksResult.code === 0) {
              const checksData = JSON.parse(checksResult.stdout.toString());
              const failedChecks =
                checksData.check_runs?.filter(
                  check => check.conclusion === 'failure' && new Date(check.completed_at) > lastCommitTime
                ) || [];

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
              operation: 'fetch_status_checks'
            });
            if (argv.verbose) {
              await log(`Warning: Could not check PR status checks: ${cleanErrorMessage(error)}`, { level: 'warning' });
            }
          }

          // 7. Check for review requests with changes requested
          try {
            const reviewsResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber}/reviews`;
            if (reviewsResult.code === 0) {
              const reviews = JSON.parse(reviewsResult.stdout.toString());
              const changesRequestedReviews = reviews.filter(
                review => review.state === 'CHANGES_REQUESTED' && new Date(review.submitted_at) > lastCommitTime
              );

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
              operation: 'fetch_pr_reviews'
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
        operation: 'detect_and_count_feedback'
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

  return { newPrComments, newIssueComments, commentInfo, feedbackLines };
};
