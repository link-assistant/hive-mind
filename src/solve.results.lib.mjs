#!/usr/bin/env node

// Results processing module for solve command
// Extracted from solve.mjs to keep files under 1500 lines

// Use use-m to dynamically import modules for cross-runtime compatibility
// Check if use is already defined globally (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

const path = (await use('path')).default;

// Import shared library functions
const lib = await import('./lib.mjs');
const {
  log,
  getLogFile,
  formatAligned
} = lib;

// Import exit handler
import { safeExit } from './exit-handler.lib.mjs';

// Import GitHub-related functions
const githubLib = await import('./github.lib.mjs');
const {
  sanitizeLogContent,
  attachLogToGitHub
} = githubLib;

// Import auto-continue functions
const autoContinue = await import('./solve.auto-continue.lib.mjs');
const {
  autoContinueWhenLimitResets
} = autoContinue;

// Import error handling functions
// const errorHandlers = await import('./solve.error-handlers.lib.mjs'); // Not currently used
// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

// Import GitHub linking detection library
const githubLinking = await import('./github-linking.lib.mjs');
const { hasGitHubLinkingKeyword } = githubLinking;

// Revert the CLAUDE.md commit to restore original state
export const cleanupClaudeFile = async (tempDir, branchName, claudeCommitHash = null) => {
  try {
    // Only revert if we have the commit hash from this session
    // This prevents reverting the wrong commit in continue mode
    if (!claudeCommitHash) {
      await log('   No CLAUDE.md commit to revert (not created in this session)', { verbose: true });
      return;
    }

    await log(formatAligned('🔄', 'Cleanup:', 'Reverting CLAUDE.md commit'));
    await log(`   Using saved commit hash: ${claudeCommitHash.substring(0, 7)}...`, { verbose: true });

    const commitToRevert = claudeCommitHash;

    // APPROACH 3: Check for modifications before reverting (proactive detection)
    // This is the main strategy - detect if CLAUDE.md was modified after initial commit
    await log('   Checking if CLAUDE.md was modified since initial commit...', { verbose: true });
    const diffResult = await $({ cwd: tempDir })`git diff ${commitToRevert} HEAD -- CLAUDE.md 2>&1`;

    if (diffResult.stdout && diffResult.stdout.trim()) {
      // CLAUDE.md was modified after initial commit - use manual approach to avoid conflicts
      await log('   CLAUDE.md was modified after initial commit, using manual cleanup...', { verbose: true });

      // Get the state of CLAUDE.md from before the initial commit (parent of the commit we're reverting)
      const parentCommit = `${commitToRevert}~1`;
      const parentFileExists = await $({ cwd: tempDir })`git cat-file -e ${parentCommit}:CLAUDE.md 2>&1`;

      if (parentFileExists.code === 0) {
        // CLAUDE.md existed before the initial commit - restore it to that state
        await log('   CLAUDE.md existed before session, restoring to previous state...', { verbose: true });
        await $({ cwd: tempDir })`git checkout ${parentCommit} -- CLAUDE.md`;
      } else {
        // CLAUDE.md didn't exist before the initial commit - delete it
        await log('   CLAUDE.md was created in session, removing it...', { verbose: true });
        await $({ cwd: tempDir })`git rm -f CLAUDE.md 2>&1`;
      }

      // Create a manual revert commit
      const commitResult = await $({ cwd: tempDir })`git commit -m "Revert: Remove CLAUDE.md changes from initial commit" 2>&1`;

      if (commitResult.code === 0) {
        await log(formatAligned('📦', 'Committed:', 'CLAUDE.md revert (manual)'));

        // Push the revert
        const pushRevertResult = await $({ cwd: tempDir })`git push origin ${branchName} 2>&1`;
        if (pushRevertResult.code === 0) {
          await log(formatAligned('📤', 'Pushed:', 'CLAUDE.md revert to GitHub'));
        } else {
          await log('   Warning: Could not push CLAUDE.md revert', { verbose: true });
        }
      } else {
        await log('   Warning: Could not create manual revert commit', { verbose: true });
        await log(`   Commit output: ${commitResult.stderr || commitResult.stdout}`, { verbose: true });
      }
    } else {
      // No modifications detected - safe to use git revert (standard approach)
      await log('   No modifications detected, using standard git revert...', { verbose: true });

      // FALLBACK 1: Standard git revert
      const revertResult = await $({ cwd: tempDir })`git revert ${commitToRevert} --no-edit 2>&1`;
      if (revertResult.code === 0) {
        await log(formatAligned('📦', 'Committed:', 'CLAUDE.md revert'));

        // Push the revert
        const pushRevertResult = await $({ cwd: tempDir })`git push origin ${branchName} 2>&1`;
        if (pushRevertResult.code === 0) {
          await log(formatAligned('📤', 'Pushed:', 'CLAUDE.md revert to GitHub'));
        } else {
          await log('   Warning: Could not push CLAUDE.md revert', { verbose: true });
        }
      } else {
        // FALLBACK 2: Handle unexpected conflicts (three-way merge with automatic resolution)
        const revertOutput = revertResult.stderr || revertResult.stdout || '';
        const hasConflict = revertOutput.includes('CONFLICT') || revertOutput.includes('conflict');

        if (hasConflict) {
          await log('   Unexpected conflict detected, attempting automatic resolution...', { verbose: true });

          // Check git status to see what files are in conflict
          const statusResult = await $({ cwd: tempDir })`git status --short 2>&1`;
          const statusOutput = statusResult.stdout || '';

          // Check if CLAUDE.md is in the conflict
          if (statusOutput.includes('CLAUDE.md')) {
            await log('   Resolving CLAUDE.md conflict by restoring pre-session state...', { verbose: true });

            // Get the state of CLAUDE.md from before the initial commit (parent of the commit we're reverting)
            const parentCommit = `${commitToRevert}~1`;
            const parentFileExists = await $({ cwd: tempDir })`git cat-file -e ${parentCommit}:CLAUDE.md 2>&1`;

            if (parentFileExists.code === 0) {
              // CLAUDE.md existed before the initial commit - restore it to that state
              await log('   CLAUDE.md existed before session, restoring to previous state...', { verbose: true });
              await $({ cwd: tempDir })`git checkout ${parentCommit} -- CLAUDE.md`;
              // Stage the resolved CLAUDE.md
              await $({ cwd: tempDir })`git add CLAUDE.md 2>&1`;
            } else {
              // CLAUDE.md didn't exist before the initial commit - delete it
              await log('   CLAUDE.md was created in session, removing it...', { verbose: true });
              await $({ cwd: tempDir })`git rm -f CLAUDE.md 2>&1`;
              // No need to git add since git rm stages the deletion
            }

            // Complete the revert with the resolved conflict
            const continueResult = await $({ cwd: tempDir })`git revert --continue --no-edit 2>&1`;

            if (continueResult.code === 0) {
              await log(formatAligned('📦', 'Committed:', 'CLAUDE.md revert (conflict resolved)'));

              // Push the revert
              const pushRevertResult = await $({ cwd: tempDir })`git push origin ${branchName} 2>&1`;
              if (pushRevertResult.code === 0) {
                await log(formatAligned('📤', 'Pushed:', 'CLAUDE.md revert to GitHub'));
              } else {
                await log('   Warning: Could not push CLAUDE.md revert', { verbose: true });
              }
            } else {
              await log('   Warning: Could not complete revert after conflict resolution', { verbose: true });
              await log(`   Continue output: ${continueResult.stderr || continueResult.stdout}`, { verbose: true });
            }
          } else {
            // Conflict in some other file, not CLAUDE.md - this is unexpected
            await log('   Warning: Revert conflict in unexpected file(s), aborting revert', { verbose: true });
            await $({ cwd: tempDir })`git revert --abort 2>&1`;
          }
        } else {
          // Non-conflict error
          await log('   Warning: Could not revert CLAUDE.md commit', { verbose: true });
          await log(`   Revert output: ${revertOutput}`, { verbose: true });
        }
      }
    }
  } catch (e) {
    reportError(e, {
      context: 'cleanup_claude_file',
      tempDir,
      operation: 'revert_claude_md_commit'
    });
    // If revert fails, that's okay - the task is still complete
    await log('   CLAUDE.md revert failed or not needed', { verbose: true });
  }
};

// Show session summary and handle limit reached scenarios
export const showSessionSummary = async (sessionId, limitReached, argv, issueUrl, tempDir, shouldAttachLogs = false) => {
  await log('\n=== Session Summary ===');

  if (sessionId) {
    await log(`✅ Session ID: ${sessionId}`);
    // Always use absolute path for log file display
    const path = (await use('path'));
    const absoluteLogPath = path.resolve(getLogFile());
    await log(`✅ Complete log file: ${absoluteLogPath}`);

    if (limitReached) {
      await log('\n⏰ LIMIT REACHED DETECTED!');

      if (argv.autoContinueOnLimitReset && global.limitResetTime) {
        await log(`\n🔄 AUTO-CONTINUE ON LIMIT RESET ENABLED - Will resume at ${global.limitResetTime}`);
        await autoContinueWhenLimitResets(issueUrl, sessionId, argv, shouldAttachLogs);
      } else {
        // Only show resume recommendation if --no-auto-cleanup was passed
        if (argv.autoCleanup === false) {
          await log('\n🔄 To resume when limit resets, use:\n');
          await log(`./solve.mjs "${issueUrl}" --resume ${sessionId}`);

          if (global.limitResetTime) {
            await log(`\n💡 Or enable auto-continue-on-limit-reset to wait until ${global.limitResetTime}:\n`);
            await log(`./solve.mjs "${issueUrl}" --resume ${sessionId} --auto-continue-on-limit-reset`);
          }

          await log('\n   This will continue from where it left off with full context.\n');
        } else {
          await log('\n⚠️  Note: Temporary directory will be automatically cleaned up.');
          await log('   To keep the directory for debugging or resuming, use --no-auto-cleanup');
        }
      }
    } else {
      // Show command to resume session in interactive mode only if --no-auto-cleanup was passed
      if (argv.autoCleanup === false) {
        await log('\n💡 To continue this session in Claude Code interactive mode:\n');
        await log(`   (cd ${tempDir} && claude --resume ${sessionId})`);
        await log('');
      } else {
        await log('\n⚠️  Note: Temporary directory will be automatically cleaned up.');
        await log('   To keep the directory for debugging or resuming, use --no-auto-cleanup');
      }
    }

    // Don't show log preview, it's too technical
  } else {
    await log('❌ No session ID extracted');
    // Always use absolute path for log file display
    const logFilePath = path.resolve(getLogFile());
    await log(`📁 Log file available: ${logFilePath}`);
  }
};

// Verify results by searching for new PRs and comments
export const verifyResults = async (owner, repo, branchName, issueNumber, prNumber, prUrl, referenceTime, argv, shouldAttachLogs, shouldRestart = false, sessionId = null, tempDir = null, anthropicTotalCostUSD = null) => {
  await log('\n🔍 Searching for created pull requests or comments...');

  try {
    // Get the current user's GitHub username
    const userResult = await $`gh api user --jq .login`;

    if (userResult.code !== 0) {
      throw new Error(`Failed to get current user: ${userResult.stderr ? userResult.stderr.toString() : 'Unknown error'}`);
    }

    const currentUser = userResult.stdout.toString().trim();
    if (!currentUser) {
      throw new Error('Unable to determine current GitHub user');
    }

    // Search for pull requests created from our branch
    await log('\n🔍 Checking for pull requests from branch ' + branchName + '...');

    // First, get all PRs from our branch
    const allBranchPrsResult = await $`gh pr list --repo ${owner}/${repo} --head ${branchName} --json number,url,createdAt,headRefName,title,state,updatedAt,isDraft`;

    if (allBranchPrsResult.code !== 0) {
      await log('  ⚠️  Failed to check pull requests');
      // Continue with empty list
    }

    const allBranchPrs = allBranchPrsResult.stdout.toString().trim() ? JSON.parse(allBranchPrsResult.stdout.toString().trim()) : [];

    // Check if we have any PRs from our branch
    // If auto-PR was created, it should be the one we're working on
    if (allBranchPrs.length > 0) {
      const pr = allBranchPrs[0]; // Get the most recent PR from our branch

      // If we created a PR earlier in this session, it would be prNumber
      // Or if the PR was updated during the session (updatedAt > referenceTime)
      const isPrFromSession = (prNumber && pr.number.toString() === prNumber) ||
                              (prUrl && pr.url === prUrl) ||
                              new Date(pr.updatedAt) > referenceTime ||
                              new Date(pr.createdAt) > referenceTime;

      if (isPrFromSession) {
        await log(`  ✅ Found pull request #${pr.number}: "${pr.title}"`);

        // Check if PR body has proper issue linking keywords
        const prBodyResult = await $`gh pr view ${pr.number} --repo ${owner}/${repo} --json body --jq .body`;
        if (prBodyResult.code === 0) {
          const prBody = prBodyResult.stdout.toString();
          const issueRef = argv.fork ? `${owner}/${repo}#${issueNumber}` : `#${issueNumber}`;

          // Use the new GitHub linking detection library to check for valid keywords
          // This ensures we only detect actual GitHub-recognized linking keywords
          // (fixes, closes, resolves and their variants) in proper format
          // See: https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue
          const hasLinkingKeyword = hasGitHubLinkingKeyword(
            prBody,
            issueNumber,
            argv.fork ? owner : null,
            argv.fork ? repo : null
          );

          if (!hasLinkingKeyword) {
            await log(`  📝 Updating PR body to link issue #${issueNumber}...`);

            // Add proper issue reference to the PR body
            const linkingText = `\n\nFixes ${issueRef}`;
            const updatedBody = prBody + linkingText;

            // Use --body-file instead of --body to avoid command-line length limits
            // and special character escaping issues that can cause hangs/timeouts
            const fs = (await use('fs')).promises;
            const tempBodyFile = `/tmp/pr-body-update-${pr.number}-${Date.now()}.md`;
            await fs.writeFile(tempBodyFile, updatedBody);

            try {
              const updateResult = await $`gh pr edit ${pr.number} --repo ${owner}/${repo} --body-file "${tempBodyFile}"`;

              // Clean up temp file
              await fs.unlink(tempBodyFile).catch(() => {});

              if (updateResult.code === 0) {
                await log(`  ✅ Updated PR body to include "Fixes ${issueRef}"`);
              } else {
                await log(`  ⚠️  Could not update PR body: ${updateResult.stderr ? updateResult.stderr.toString().trim() : 'Unknown error'}`);
              }
            } catch (updateError) {
              // Clean up temp file on error
              await fs.unlink(tempBodyFile).catch(() => {});
              throw updateError;
            }
          } else {
            await log('  ✅ PR body already contains issue reference');
          }
        }

        // Check if PR is ready for review (convert from draft if necessary)
        if (pr.isDraft) {
          await log('  🔄 Converting PR from draft to ready for review...');
          const readyResult = await $`gh pr ready ${pr.number} --repo ${owner}/${repo}`;
          if (readyResult.code === 0) {
            await log('  ✅ PR converted to ready for review');
          } else {
            await log(`  ⚠️  Could not convert PR to ready (${readyResult.stderr ? readyResult.stderr.toString().trim() : 'unknown error'})`);
          }
        } else {
          await log('  ✅ PR is already ready for review', { verbose: true });
        }

        // Upload log file to PR if requested
        let logUploadSuccess = false;
        if (shouldAttachLogs) {
          await log('\n📎 Uploading solution draft log to Pull Request...');
          logUploadSuccess = await attachLogToGitHub({
            logFile: getLogFile(),
            targetType: 'pr',
            targetNumber: pr.number,
            owner,
            repo,
            $,
            log,
            sanitizeLogContent,
            verbose: argv.verbose,
            sessionId,
            tempDir,
            anthropicTotalCostUSD
          });
        }

        await log('\n🎉 SUCCESS: A solution draft has been prepared as a pull request');
        await log(`📍 URL: ${pr.url}`);
        if (shouldAttachLogs && logUploadSuccess) {
          await log('📎 Solution draft log has been attached to the Pull Request');
        } else if (shouldAttachLogs && !logUploadSuccess) {
          await log('⚠️  Solution draft log upload was requested but failed');
        }
        await log('\n✨ Please review the pull request for the proposed solution draft.');
        // Don't exit if watch mode is enabled OR if auto-restart is needed for uncommitted changes
        if (!argv.watch && !shouldRestart) {
          await safeExit(0, 'Process completed successfully');
        }
        return; // Return normally for watch mode or auto-restart
      } else {
        await log(`  ℹ️  Found pull request #${pr.number} but it appears to be from a different session`);
      }
    } else {
      await log(`  ℹ️  No pull requests found from branch ${branchName}`);
    }

    // If no PR found, search for recent comments on the issue
    await log('\n🔍 Checking for new comments on issue #' + issueNumber + '...');

    // Get all comments and filter them
    const allCommentsResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments`;

    if (allCommentsResult.code !== 0) {
      await log('  ⚠️  Failed to check comments');
      // Continue with empty list
    }

    const allComments = JSON.parse(allCommentsResult.stdout.toString().trim() || '[]');

    // Filter for new comments by current user
    const newCommentsByUser = allComments.filter(comment =>
      comment.user.login === currentUser && new Date(comment.created_at) > referenceTime
    );

    if (newCommentsByUser.length > 0) {
      const lastComment = newCommentsByUser[newCommentsByUser.length - 1];
      await log(`  ✅ Found new comment by ${currentUser}`);

      // Upload log file to issue if requested
      if (shouldAttachLogs) {
        await log('\n📎 Uploading solution draft log to issue...');
        await attachLogToGitHub({
          logFile: getLogFile(),
          targetType: 'issue',
          targetNumber: issueNumber,
          owner,
          repo,
          $,
          log,
          sanitizeLogContent,
          verbose: argv.verbose,
          sessionId,
          tempDir,
          anthropicTotalCostUSD
        });
      }

      await log('\n💬 SUCCESS: Comment posted on issue');
      await log(`📍 URL: ${lastComment.html_url}`);
      if (shouldAttachLogs) {
        await log('📎 Solution draft log has been attached to the issue');
      }
      await log('\n✨ A clarifying comment has been added to the issue.');
      // Don't exit if watch mode is enabled OR if auto-restart is needed for uncommitted changes
      if (!argv.watch && !shouldRestart) {
        await safeExit(0, 'Process completed successfully');
      }
      return; // Return normally for watch mode or auto-restart
    } else if (allComments.length > 0) {
      await log(`  ℹ️  Issue has ${allComments.length} existing comment(s)`);
    } else {
      await log('  ℹ️  No comments found on issue');
    }

    // If neither found, it might not have been necessary to create either
    await log('\n📋 No new pull request or comment was created.');
    await log('   The issue may have been resolved differently or required no action.');
    await log('\n💡 Review the session log for details:');
    // Always use absolute path for log file display
    const reviewLogPath = path.resolve(getLogFile());
    await log(`   ${reviewLogPath}`);
    // Don't exit if watch mode is enabled - it needs to continue monitoring
    if (!argv.watch) {
      await safeExit(0, 'Process completed successfully');
    }
    return; // Return normally for watch mode

  } catch (searchError) {
    reportError(searchError, {
      context: 'verify_pr_creation',
      issueNumber,
      operation: 'search_for_pr'
    });
    await log('\n⚠️  Could not verify results:', searchError.message);
    await log('\n💡 Check the log file for details:');
    // Always use absolute path for log file display
    const checkLogPath = path.resolve(getLogFile());
    await log(`   ${checkLogPath}`);
    // Don't exit if watch mode is enabled - it needs to continue monitoring
    if (!argv.watch) {
      await safeExit(0, 'Process completed successfully');
    }
    return; // Return normally for watch mode
  }
};

// Handle execution errors with log attachment
export const handleExecutionError = async (error, shouldAttachLogs, owner, repo, argv = {}) => {
  const { cleanErrorMessage } = await import('./lib.mjs');
  await log('Error executing command:', cleanErrorMessage(error));
  await log(`Stack trace: ${error.stack}`, { verbose: true });

  // If --attach-logs is enabled, try to attach failure logs
  if (shouldAttachLogs && getLogFile()) {
    await log('\n📄 Attempting to attach failure logs...');

    // Try to attach to existing PR first
    if (global.createdPR && global.createdPR.number) {
      try {
        const logUploadSuccess = await attachLogToGitHub({
          logFile: getLogFile(),
          targetType: 'pr',
          targetNumber: global.createdPR.number,
          owner,
          repo,
          $,
          log,
          sanitizeLogContent,
          verbose: argv.verbose || false,
          errorMessage: cleanErrorMessage(error)
        });

        if (logUploadSuccess) {
          await log('📎 Failure log attached to Pull Request');
        }
      } catch (attachError) {
        reportError(attachError, {
          context: 'attach_success_log',
          prNumber: global.createdPR?.number,
          operation: 'attach_log_to_pr'
        });
        await log(`⚠️  Could not attach failure log: ${attachError.message}`, { level: 'warning' });
      }
    }
  }

  // If --auto-close-pull-request-on-fail is enabled, close the PR
  if (argv.autoClosePullRequestOnFail && global.createdPR && global.createdPR.number) {
    await log('\n🔒 Auto-closing pull request due to failure...');
    try {
      const result = await $`gh pr close ${global.createdPR.number} --repo ${owner}/${repo} --comment "Auto-closed due to execution failure. Logs have been attached for debugging."`;
      if (result.exitCode === 0) {
        await log('✅ Pull request closed successfully');
      } else {
        await log(`⚠️  Could not close pull request: ${result.stderr}`, { level: 'warning' });
      }
    } catch (closeError) {
      reportError(closeError, {
        context: 'close_success_pr',
        prNumber: global.createdPR?.number,
        operation: 'close_pull_request'
      });
      await log(`⚠️  Could not close pull request: ${closeError.message}`, { level: 'warning' });
    }
  }

  await safeExit(1, 'Execution error');
};