/**
 * Post-push GitHub synchronization for auto-PR creation.
 *
 * Extracted from src/solve.auto-pr.lib.mjs (issue #2175) so that file stays
 * under the 1350-line early-warning threshold that protects concurrent merges
 * (#1593). Behaviour is unchanged; the collaborators that were closure bindings
 * are now parameters.
 *
 * A push is accepted by git receive long before GitHub's compare/PR API can see
 * the new commits, so `gh pr create` run immediately after a push fails with
 * "No commits between branches". Both helpers here close that gap: the first
 * polls the compare API until it reports commits ahead, the second confirms the
 * branch itself is visible and re-pushes it (never forced) when it is not.
 */

/**
 * Poll GitHub's compare API until it reports commits ahead of the base branch.
 *
 * @param {object} deps
 * @returns {Promise<{compareReady: boolean, targetBranchForCompare: string}>}
 */
export async function waitForCompareApiReady({ argv, defaultBranch, branchName, forkedRepo, owner, repo, issueNumber, log, formatAligned, $, isTransientCompareApiError, handleCompareApiNotReady }) {
  // CRITICAL: Wait for GitHub to process the push before creating PR
  // This prevents "No commits between branches" error
  await log('   Waiting for GitHub to sync...');

  // Use exponential backoff to wait for GitHub's compare API to see the commits
  // This is essential because GitHub has multiple backend systems:
  // - Git receive: Accepts push immediately
  // - Branch API: Returns quickly from cache
  // - Compare/PR API: May take longer to index commits
  let compareReady = false;
  let compareAttempts = 0;
  const maxCompareAttempts = 5;
  const targetBranchForCompare = argv.baseBranch || defaultBranch;
  let compareResult; // Declare outside loop so it's accessible for error checking

  while (!compareReady && compareAttempts < maxCompareAttempts) {
    compareAttempts++;
    const waitTime = Math.min(2000 * compareAttempts, 10000); // 2s, 4s, 6s, 8s, 10s

    if (compareAttempts > 1) {
      await log(`   Retry ${compareAttempts}/${maxCompareAttempts}: Waiting ${waitTime}ms for GitHub to index commits...`);
    }

    await new Promise(resolve => setTimeout(resolve, waitTime));

    // Check if GitHub's compare API can see commits between base and head
    // This is the SAME API that gh pr create uses internally, so if this works,
    // PR creation should work too
    // For fork mode, we need to use forkUser:branchName format for the head
    let headRef;
    if (argv.fork && forkedRepo) {
      const forkUser = forkedRepo.split('/')[0];
      headRef = `${forkUser}:${branchName}`;
    } else {
      headRef = branchName;
    }
    compareResult = await $({
      silent: true,
    })`gh api repos/${owner}/${repo}/compare/${targetBranchForCompare}...${headRef} --paginate --jq '.ahead_by' 2>&1`;

    if (compareResult.code === 0) {
      const aheadBy = parseInt(compareResult.stdout.toString().trim(), 10);
      if (argv.verbose) {
        await log(`   Compare API check: ${aheadBy} commit(s) ahead of ${targetBranchForCompare}`);
      }

      if (aheadBy > 0) {
        compareReady = true;
        await log(`   GitHub compare API ready: ${aheadBy} commit(s) found`);
      } else {
        await log(`   ⚠️ GitHub compare API shows 0 commits ahead (attempt ${compareAttempts}/${maxCompareAttempts})`, { level: 'warning' });
      }
    } else {
      // Issue #1829: surface compare-API failures in normal output (not
      // only verbose) so the degraded-mode decision below is explainable
      // from the logs. Build the text as a STRING — the command-stream
      // result exposes stdout/stderr as Buffers, and the transient
      // detectors call String.prototype.toLowerCase().
      const errorText = `${compareResult.stdout?.toString?.() ?? ''}${compareResult.stderr?.toString?.() ?? ''}`.trim();
      const firstLine =
        errorText
          .split('\n')
          .map(s => s.trim())
          .filter(Boolean)[0] || 'unknown';
      const transientNote = isTransientCompareApiError(errorText) ? ' (transient server error)' : '';
      await log(`   ⚠️ GitHub compare API error${transientNote} (attempt ${compareAttempts}/${maxCompareAttempts}): ${firstLine}`, { level: 'warning' });
      if (argv.verbose && errorText) {
        await log(`   Compare API full output: ${errorText}`, { verbose: true });
      }
    }
  }

  if (!compareReady) {
    compareReady = await handleCompareApiNotReady({
      argv,
      forkedRepo,
      owner,
      repo,
      issueNumber,
      branchName,
      targetBranchForCompare,
      maxCompareAttempts,
      compareResult,
      log,
      formatAligned,
      $,
    });
  }

  return { compareReady, targetBranchForCompare };
}

/**
 * Confirm the pushed branch is visible on GitHub, re-pushing it (never forced)
 * when it is not.
 *
 * @param {object} deps
 * @returns {Promise<void>}
 */
export async function verifyBranchOnGitHub({ argv, tempDir, branchName, forkedRepo, owner, repo, log, $ }) {
  // Verify the push actually worked by checking GitHub API
  // When using fork mode, check the fork repository; otherwise check the original repository
  const repoToCheck = argv.fork && forkedRepo ? forkedRepo : `${owner}/${repo}`;
  const branchCheckResult = await $({
    silent: true,
  })`gh api repos/${repoToCheck}/branches/${branchName} --jq .name 2>&1`;
  if (branchCheckResult.code === 0 && branchCheckResult.stdout.toString().trim() === branchName) {
    await log(`   Branch verified on GitHub: ${branchName}`);

    // Get the commit SHA from GitHub
    const shaCheckResult = await $({
      silent: true,
    })`gh api repos/${repoToCheck}/branches/${branchName} --jq .commit.sha 2>&1`;
    if (shaCheckResult.code === 0) {
      const remoteSha = shaCheckResult.stdout.toString().trim();
      await log(`   Remote commit SHA: ${remoteSha.substring(0, 7)}...`);
    }
  } else {
    await log('   Warning: Branch not found on GitHub!');
    await log('   This will cause PR creation to fail.');

    if (argv.verbose) {
      await log(`   Branch check result: ${branchCheckResult.stdout || branchCheckResult.stderr || 'empty'}`);

      // Show all branches on GitHub
      const allBranchesResult = await $({
        silent: true,
      })`gh api repos/${repoToCheck}/branches --paginate --jq '.[].name' 2>&1`;
      if (allBranchesResult.code === 0) {
        await log(`   All GitHub branches: ${allBranchesResult.stdout.toString().split('\n').slice(0, 5).join(', ')}...`);
      }
    }

    // Try one more push with explicit ref (without force)
    await log('   Attempting explicit push...');
    const explicitPushCmd = `git push origin HEAD:refs/heads/${branchName}`;
    if (argv.verbose) {
      await log(`   Command: ${explicitPushCmd}`);
    }
    const explicitPushResult = await $`cd ${tempDir} && ${explicitPushCmd} 2>&1`;
    if (explicitPushResult.code === 0) {
      await log('   Explicit push completed');
      if (argv.verbose && explicitPushResult.stdout) {
        await log(`   Output: ${explicitPushResult.stdout.toString().trim()}`);
      }
      // Wait a bit more for GitHub to process
      await new Promise(resolve => setTimeout(resolve, 3000));
    } else {
      await log('   ERROR: Cannot push to GitHub!');
      await log(`   Error: ${explicitPushResult.stderr || explicitPushResult.stdout || 'Unknown'}`);
      await log('   Force push is not allowed to preserve history');
    }
  }
}
