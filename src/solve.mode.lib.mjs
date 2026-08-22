/**
 * Resolve which mode solve.mjs is running in and collect the pull request /
 * issue facts that mode implies.
 *
 * Three entry shapes converge here:
 *   - `--auto-continue` on an issue URL, which may find an existing pull
 *     request (or just a branch left behind by an earlier run);
 *   - a pull request URL, whose head branch and linked issue are read from the
 *     API;
 *   - a plain issue URL, which is the traditional mode.
 *
 * Fork detection is shared by the first two: a pull request whose head
 * repository owner differs from the upstream owner puts solve in fork mode,
 * unless the upstream is private and the user has write access (issue #1716),
 * in which case working directly on the upstream is both possible and safer.
 *
 * Extracted from solve.mjs (issue #2175) so that file stays under the
 * 1350-line early-warning threshold of the CI file-headroom check (long files
 * cause concurrent PR merge conflicts — issue #1593). Behaviour is unchanged,
 * including the `global.createdPR` assignments the error handlers read.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2175
 */

/**
 * @param {object} deps every collaborator solve.mjs already has in scope
 * @returns {Promise<{issueNumber: number|undefined, prNumber: number|undefined, prBranch: string|undefined, mergeStateStatus: string|undefined, prState: string|undefined, forkOwner: string|null, forkRepoName: string|null, isContinueMode: boolean}>}
 */
export async function resolveSolveMode({ argv, owner, repo, urlNumber, issueUrl, isIssueUrl, isPrUrl, skipForkForPrivateUpstream, shouldAttachLogs, log, safeExit, githubLib, processAutoContinueForIssue, handleMaintainerForkAccess, extractLinkedIssueNumber, reportError, cleanErrorMessage }) {
  let issueNumber;
  let prNumber;
  let prBranch;
  let mergeStateStatus;
  let prState;
  let forkOwner = null;
  let forkRepoName = null;
  let isContinueMode = false;
  // Auto-continue logic: check for existing PRs if --auto-continue is enabled
  const autoContinueResult = await processAutoContinueForIssue(argv, isIssueUrl, urlNumber, owner, repo);
  if (autoContinueResult.isContinueMode) {
    isContinueMode = true;
    prNumber = autoContinueResult.prNumber;
    prBranch = autoContinueResult.prBranch;
    issueNumber = autoContinueResult.issueNumber;
    // Only check PR details if we have a PR number
    if (prNumber) {
      // Store PR info globally for error handlers
      global.createdPR = { number: prNumber };
      // Check if PR is from a fork and get fork owner, merge status, and PR state
      if (argv.verbose) {
        await log('   Checking if PR is from a fork...', { verbose: true });
      }
      try {
        // Issue #2175: routed through githubLib.ghPrView (the same helper the
        // pull-request-URL branch below uses) instead of a direct `$` call to
        // `gh`, so the request goes through the rate-limit-safe wrapper.
        const prCheckResult = await githubLib.ghPrView({ prNumber, owner, repo, jsonFields: 'headRepositoryOwner,headRepository,mergeStateStatus,state' });
        if (prCheckResult.code === 0 && prCheckResult.data) {
          const prCheckData = prCheckResult.data;
          // Extract merge status and PR state
          mergeStateStatus = prCheckData.mergeStateStatus;
          prState = prCheckData.state;
          if (argv.verbose) {
            await log(`   PR state: ${prState || 'UNKNOWN'}`, { verbose: true });
            await log(`   Merge status: ${mergeStateStatus || 'UNKNOWN'}`, { verbose: true });
          }
          if (prCheckData.headRepositoryOwner && prCheckData.headRepositoryOwner.login !== owner) {
            const detectedForkOwner = prCheckData.headRepositoryOwner.login;
            const detectedForkRepoName = prCheckData.headRepository && prCheckData.headRepository.name ? prCheckData.headRepository.name : null;
            // Issue #1716: Skip fork mode for private upstream repos with write access.
            if (skipForkForPrivateUpstream) {
              await log(`🔒 Detected fork PR from ${detectedForkOwner}/${detectedForkRepoName || repo}, but upstream ${owner}/${repo} is private and you have write access.`);
              await log('   Working directly on the private upstream repository (Issue #1716).');
            } else {
              forkOwner = detectedForkOwner;
              // Get actual fork repository name (may be prefixed) and store for use in setupRepository
              forkRepoName = detectedForkRepoName;
              await log(`🍴 Detected fork PR from ${forkOwner}/${forkRepoName || repo}`);
              if (argv.verbose) {
                await log(`   Fork owner: ${forkOwner}`, { verbose: true });
                await log('   Will clone fork repository for continue mode', { verbose: true });
              }
            }
            // Check if maintainer can push to the fork when --allow-to-push-to-contributors-pull-requests-as-maintainer is enabled
            if (forkOwner && argv.allowToPushToContributorsPullRequestsAsMaintainer && argv.autoFork) {
              await handleMaintainerForkAccess({ owner, repo, prNumber });
            }
          }
        }
      } catch (forkCheckError) {
        if (argv.verbose) {
          await log(`   Warning: Could not check fork status: ${forkCheckError.message}`, { verbose: true });
        }
      }
    } else {
      // We have a branch but no PR - we'll use the existing branch and create a PR later
      await log(`🔄 Using existing branch: ${prBranch} (no PR yet - will create one)`);
      await log('   This branch was created by an earlier run; this run is reusing it rather than creating a fresh branch.');
      if (argv.verbose) {
        await log('   Branch will be checked out and PR will be created during auto-PR creation phase', {
          verbose: true,
        });
      }
    }
  } else if (isIssueUrl) {
    issueNumber = autoContinueResult.issueNumber || urlNumber;
  }
  if (isPrUrl) {
    isContinueMode = true;
    prNumber = urlNumber;
    // Store PR info globally for error handlers
    global.createdPR = { number: prNumber, url: issueUrl };
    await log(`🔄 Continue mode: Working with PR #${prNumber}`);
    if (argv.verbose) {
      await log('   Continue mode activated: PR URL provided directly', { verbose: true });
      await log(`   PR Number set to: ${prNumber}`, { verbose: true });
      await log('   Will fetch PR details and linked issue', { verbose: true });
    }
    // Get PR details to find the linked issue and branch
    try {
      const prResult = await githubLib.ghPrView({
        prNumber,
        owner,
        repo,
        jsonFields: 'headRefName,body,number,mergeStateStatus,state,headRepositoryOwner,headRepository',
      });
      if (prResult.code !== 0 || !prResult.data) {
        await log('Error: Failed to get PR details', { level: 'error' });
        if (prResult.output.includes('Could not resolve to a PullRequest')) {
          await githubLib.handlePRNotFoundError({ prNumber, owner, repo, argv, shouldAttachLogs });
        } else {
          await log(`Error: ${prResult.stderr || 'Unknown error'}`, { level: 'error' });
        }
        await safeExit(1, 'Failed to get PR details');
      }
      const prData = prResult.data;
      prBranch = prData.headRefName;
      mergeStateStatus = prData.mergeStateStatus;
      prState = prData.state;
      // Check if this is a fork PR
      if (prData.headRepositoryOwner && prData.headRepositoryOwner.login !== owner) {
        const detectedForkOwner = prData.headRepositoryOwner.login;
        const detectedForkRepoName = prData.headRepository && prData.headRepository.name ? prData.headRepository.name : null;
        // Issue #1716: Skip fork mode for private upstream repos with write access.
        if (skipForkForPrivateUpstream) {
          await log(`🔒 Detected fork PR from ${detectedForkOwner}/${detectedForkRepoName || repo}, but upstream ${owner}/${repo} is private and you have write access.`);
          await log('   Working directly on the private upstream repository (Issue #1716).');
        } else {
          forkOwner = detectedForkOwner;
          // Get actual fork repository name and store for use in setupRepository
          forkRepoName = detectedForkRepoName;
          await log(`🍴 Detected fork PR from ${forkOwner}/${forkRepoName || repo}`);
          if (argv.verbose) {
            await log(`   Fork owner: ${forkOwner}`, { verbose: true });
            await log('   Will clone fork repository for continue mode', { verbose: true });
          }
        }
        // Check if maintainer can push to the fork when --allow-to-push-to-contributors-pull-requests-as-maintainer is enabled
        if (forkOwner && argv.allowToPushToContributorsPullRequestsAsMaintainer && argv.autoFork) {
          await handleMaintainerForkAccess({ owner, repo, prNumber });
        }
      }
      await log(`📝 PR branch: ${prBranch}`);
      const prBody = prData.body || '';
      const extractedIssueNumber = extractLinkedIssueNumber(prBody);
      if (extractedIssueNumber) {
        issueNumber = extractedIssueNumber;
        await log(`🔗 Found linked issue #${issueNumber}`);
      } else {
        // If no linked issue found, we can still continue but warn
        await log('⚠️  Warning: No linked issue found in PR body', { level: 'warning' });
        await log('   The PR should contain "Fixes #123" or similar to link an issue', { level: 'warning' });
        // Set issueNumber to PR number as fallback
        issueNumber = prNumber;
      }
    } catch (error) {
      reportError(error, {
        context: 'pr_processing',
        prNumber,
        operation: 'process_pull_request',
      });
      await log(`Error: Failed to process PR: ${cleanErrorMessage(error)}`, { level: 'error' });
      await safeExit(1, 'Failed to process PR');
    }
  } else {
    // Traditional issue mode
    issueNumber = urlNumber;
    await log(`📝 Issue mode: Working with issue #${issueNumber}`);
  }
  return { issueNumber, prNumber, prBranch, mergeStateStatus, prState, forkOwner, forkRepoName, isContinueMode };
}
