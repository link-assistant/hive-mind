/**
 * Compare-API readiness handler for the auto-PR pipeline.
 *
 * After a branch is pushed, the auto-PR flow polls GitHub's compare endpoint
 * (`/repos/{owner}/{repo}/compare/{base}...{head}`) to confirm the pushed
 * commits are visible before calling `gh pr create`. When that poll never
 * reports commits ahead, this helper decides what the failure means:
 *
 *   • HTTP 404 (fork mode) → repository mismatch. Investigate the fork
 *     relationship and abort with an actionable error (FATAL).
 *   • Issue #1829: a transient compare/diff failure (HTTP 500 "this diff is
 *     temporarily unavailable due to heavy server load" / code
 *     `not_available`, or a 5xx gateway error). The branch and commits were
 *     already pushed and `gh pr create` does not render the full diff, so this
 *     is a diff-RENDERING failure, NOT missing commits. Degrade gracefully and
 *     return `true` so the caller proceeds to PR creation — still guarded by
 *     branch verification and the LOCAL `git rev-list` commit check.
 *   • Anything else (genuinely 0 commits ahead / unknown failure) → abort with
 *     the original "GitHub compare API not ready" error (FATAL).
 *
 * Extracted from solve.auto-pr.lib.mjs to keep that file under the 1500-line
 * CI cap.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1829
 */

import { isTransientCompareApiError } from './github-rate-limit.lib.mjs'; // Issue #1829: lets the compare-API readiness gate degrade gracefully on transient diff-render failures.

/**
 * Handle the case where the compare-API readiness poll never saw commits.
 *
 * @param {object} params
 * @param {object} params.argv
 * @param {string|null} params.forkedRepo
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string|number} params.issueNumber
 * @param {string} params.branchName
 * @param {string} params.targetBranchForCompare
 * @param {number} params.maxCompareAttempts
 * @param {object} params.compareResult - last command-stream compare result.
 * @param {(msg: string, opts?: object) => Promise<void>} params.log
 * @param {(symbol: string, label: string, value: string) => string} params.formatAligned
 * @param {Function} params.$ - command-stream tagged function from solve.
 * @returns {Promise<boolean>} `true` when the failure was transient and PR
 *   creation should proceed (degraded mode). Throws on fatal failures.
 */
export async function handleCompareApiNotReady({ argv, forkedRepo, owner, repo, issueNumber, branchName, targetBranchForCompare, maxCompareAttempts, compareResult, log, formatAligned, $ }) {
  // Issue #1829: build the last compare-API output as a STRING. The
  // command-stream result exposes stdout/stderr as Buffers, and both
  // the 404 check below and isTransientCompareApiError expect a string
  // (the rate-limit lib's collectErrorText returns '' for a raw Buffer).
  const lastCompareOutput = `${compareResult?.stdout?.toString?.() ?? ''}${compareResult?.stderr?.toString?.() ?? ''}`;

  // Check if this is a repository mismatch error (HTTP 404 from compare API)
  let isRepositoryMismatch = false;
  if (argv.fork && forkedRepo) {
    // For fork mode, check the last compare API call result for 404
    if (lastCompareOutput.includes('HTTP 404') || lastCompareOutput.includes('Not Found')) {
      isRepositoryMismatch = true;
    }
  }

  // Issue #1829: GitHub's compare/diff endpoint can return a transient
  // HTTP 500 ("this diff is temporarily unavailable due to heavy server
  // load" / code "not_available") or a 5xx gateway error under load.
  // That is a diff-RENDERING failure, NOT a "commits not indexed yet"
  // condition: the branch and commits were already pushed, and
  // `gh pr create` does not render the full diff, so it would still
  // succeed. Aborting here used to kill the whole session needlessly.
  // Treat a purely transient compare failure as non-fatal and fall
  // through to PR creation — still guarded by the branch verification
  // and the LOCAL `git rev-list` commit check below (and `gh pr create`
  // itself retries transient 5xx via execGhWithRetry).
  const compareFailedTransiently = !isRepositoryMismatch && isTransientCompareApiError(lastCompareOutput);

  if (isRepositoryMismatch) {
    // BEFORE showing any error, verify if the repository is actually a GitHub fork
    await log('');
    await log(formatAligned('🔍', 'Investigating:', 'Checking fork relationship...'));

    const forkInfoResult = await $({
      silent: true,
    })`gh api repos/${forkedRepo} --jq '{fork: .fork, parent: .parent.full_name, source: .source.full_name}' 2>&1`;

    let isFork = false;
    let parentRepo = null;
    let sourceRepo = null;

    if (forkInfoResult.code === 0) {
      try {
        const forkInfo = JSON.parse(forkInfoResult.stdout.toString().trim());
        isFork = forkInfo.fork === true;
        parentRepo = forkInfo.parent || null;
        sourceRepo = forkInfo.source || null;
      } catch {
        // Failed to parse fork info
      }
    }

    if (!isFork) {
      // Repository is NOT a fork at all
      await log('');
      await log(formatAligned('❌', 'NOT A GITHUB FORK:', 'Repository is not a fork'), { level: 'error' });
      await log('');
      await log('  🔍 What happened:');
      await log(`     The repository ${forkedRepo} is NOT a GitHub fork.`);
      await log('     GitHub API reports: fork=false, parent=null');
      await log('');
      await log('  💡 Why this happens:');
      await log('     This repository was likely created by cloning and pushing (git clone + git push)');
      await log("     instead of using GitHub's Fork button or API.");
      await log('');
      await log('     When a repository is created this way:');
      await log('     • GitHub does not track it as a fork');
      await log('     • It has no parent relationship with the original repository');
      await log('     • Pull requests cannot be created to the original repository');
      await log('     • Compare API returns 404 when comparing with unrelated repositories');
      await log('');
      await log('  📦 Repository details:');
      await log('     • Target repository: ' + `${owner}/${repo}`);
      await log('     • Your repository: ' + forkedRepo);
      await log('     • Fork status: false (NOT A FORK)');
      await log('');
      await log('  🔧 How to fix:');
      await log('     Option 1: Delete the non-fork repository and create a proper fork');
      await log(`        gh repo delete ${forkedRepo}`);
      await log(`        Then run this command again to create a proper GitHub fork of ${owner}/${repo}`);
      await log('');
      await log('     Option 2: Use --prefix-fork-name-with-owner-name to avoid name conflicts');
      await log(`        ./solve.mjs "https://github.com/${owner}/${repo}/issues/${issueNumber}" --prefix-fork-name-with-owner-name`);
      await log('        This creates forks with names like "owner-repo" instead of just "repo"');
      await log('');
      await log('     Option 3: Work directly on the repository (if you have write access)');
      await log(`        ./solve.mjs "https://github.com/${owner}/${repo}/issues/${issueNumber}" --no-fork`);
      await log('');

      throw new Error('Repository is not a GitHub fork - cannot create PR to unrelated repository');
    } else if (parentRepo !== `${owner}/${repo}` && sourceRepo !== `${owner}/${repo}`) {
      // Repository IS a fork, but of a different repository
      await log('');
      await log(formatAligned('❌', 'WRONG FORK PARENT:', 'Fork is from different repository'), {
        level: 'error',
      });
      await log('');
      await log('  🔍 What happened:');
      await log(`     The repository ${forkedRepo} IS a GitHub fork,`);
      await log(`     but it's a fork of a DIFFERENT repository than ${owner}/${repo}.`);
      await log('');
      await log('  📦 Fork relationship:');
      await log('     • Your fork: ' + forkedRepo);
      await log('     • Fork parent: ' + (parentRepo || 'unknown'));
      await log('     • Fork source: ' + (sourceRepo || 'unknown'));
      await log('     • Target repository: ' + `${owner}/${repo}`);
      await log('');
      await log('  💡 Why this happens:');
      await log('     You have an existing fork from a different repository');
      await log('     that shares the same name but is from a different source.');
      await log('     GitHub treats forks hierarchically - each fork tracks its root repository.');
      await log('');
      await log('  🔧 How to fix:');
      await log('     Option 1: Delete the conflicting fork and create a new one');
      await log(`        gh repo delete ${forkedRepo}`);
      await log(`        Then run this command again to create a proper fork of ${owner}/${repo}`);
      await log('');
      await log('     Option 2: Use --prefix-fork-name-with-owner-name to avoid conflicts');
      await log(`        ./solve.mjs "https://github.com/${owner}/${repo}/issues/${issueNumber}" --prefix-fork-name-with-owner-name`);
      await log('        This creates forks with names like "owner-repo" instead of just "repo"');
      await log('');
      await log('     Option 3: Work directly on the repository (if you have write access)');
      await log(`        ./solve.mjs "https://github.com/${owner}/${repo}/issues/${issueNumber}" --no-fork`);
      await log('');

      throw new Error('Fork parent mismatch - fork is from different repository tree');
    } else {
      // Repository is a fork of the correct parent, but compare API still failed
      // This is unexpected - show detailed error
      await log('');
      await log(formatAligned('❌', 'COMPARE API ERROR:', 'Unexpected failure'), { level: 'error' });
      await log('');
      await log('  🔍 What happened:');
      await log(`     The repository ${forkedRepo} is a valid fork of ${owner}/${repo},`);
      await log("     but GitHub's compare API still returned an error.");
      await log('');
      await log('  📦 Fork verification:');
      await log('     • Your fork: ' + forkedRepo);
      await log('     • Fork status: true (VALID FORK)');
      await log('     • Fork parent: ' + (parentRepo || 'unknown'));
      await log('     • Target repository: ' + `${owner}/${repo}`);
      await log('');
      await log('  💡 This is unexpected:');
      await log('     The fork relationship is correct, but the compare API failed.');
      await log('     This might be a temporary GitHub API issue.');
      await log('');
      await log('  🔧 How to fix:');
      await log('     1. Wait a minute and try creating the PR manually:');
      if (argv.fork && forkedRepo) {
        const forkUser = forkedRepo.split('/')[0];
        await log(`        gh pr create --draft --repo ${owner}/${repo} --base ${targetBranchForCompare} --head ${forkUser}:${branchName}`);
      }
      await log('     2. Check if the issue persists - it might be a GitHub API outage');
      await log('');

      throw new Error('Compare API failed unexpectedly despite valid fork relationship');
    }
  } else if (compareFailedTransiently) {
    // Issue #1829: the compare API failed only with a transient server
    // error. Degrade gracefully — proceed to PR creation rather than
    // aborting the whole session.
    await log('');
    await log(formatAligned('⚠️', 'COMPARE API DEGRADED:', 'Transient server error — proceeding'), {
      level: 'warning',
    });
    await log('');
    await log('  🔍 What happened:');
    await log(`     GitHub's compare API failed with a transient server error after ${maxCompareAttempts} attempts`);
    await log('     (e.g. HTTP 500 "this diff is temporarily unavailable due to heavy server');
    await log('     load", or a 5xx gateway error).');
    await log('');
    await log('  💡 Why this is safe to ignore:');
    await log('     • The branch and commits were already pushed successfully.');
    await log('     • This is a diff-RENDERING failure, not missing commits.');
    await log('     • `gh pr create` does not render the full diff, so it can still succeed.');
    await log('     • The branch is verified on GitHub and the local commit count is');
    await log('       re-checked before PR creation; `gh pr create` retries 5xx errors too.');
    await log('');
    await log('  ➡️  Proceeding to PR creation despite the compare API error (issue #1829).');
    await log('');
    const firstLine =
      lastCompareOutput
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)[0] || 'unknown';
    await log(`   Last compare API output: ${firstLine}`, { verbose: true });
    // Fall through to branch verification + local commit check + PR creation.
    return true;
  } else {
    // Original timeout error for other cases
    await log('');
    await log(formatAligned('❌', 'GITHUB SYNC TIMEOUT:', 'Compare API not ready after retries'), {
      level: 'error',
    });
    await log('');
    await log('  🔍 What happened:');
    await log(`     After ${maxCompareAttempts} attempts, GitHub's compare API still shows no commits`);
    await log(`     between ${targetBranchForCompare} and ${branchName}.`);
    await log('');
    await log('  💡 This usually means:');
    await log("     • GitHub's backend systems haven't finished indexing the push");
    await log("     • There's a temporary issue with GitHub's API");
    await log('     • The commits may not have been pushed correctly');
    await log('');
    await log('  🔧 How to fix:');
    await log('     1. Wait a minute and try creating the PR manually:');
    // For fork mode, use the correct head reference format
    if (argv.fork && forkedRepo) {
      const forkUser = forkedRepo.split('/')[0];
      await log(`        gh pr create --draft --repo ${owner}/${repo} --base ${targetBranchForCompare} --head ${forkUser}:${branchName}`);
    } else {
      await log(`        gh pr create --draft --repo ${owner}/${repo} --base ${targetBranchForCompare} --head ${branchName}`);
    }
    await log('     2. Check if the branch exists on GitHub:');
    // Show the correct repository where the branch was pushed
    const branchRepo = argv.fork && forkedRepo ? forkedRepo : `${owner}/${repo}`;
    await log(`        https://github.com/${branchRepo}/tree/${branchName}`);
    await log('     3. Check the commit is on GitHub:');
    // Use the correct head reference for the compare API check
    if (argv.fork && forkedRepo) {
      const forkUser = forkedRepo.split('/')[0];
      await log(`        gh api repos/${owner}/${repo}/compare/${targetBranchForCompare}...${forkUser}:${branchName} --paginate`);
    } else {
      await log(`        gh api repos/${owner}/${repo}/compare/${targetBranchForCompare}...${branchName} --paginate`);
    }
    await log('');

    throw new Error('GitHub compare API not ready - cannot create PR safely');
  }
}

export default { handleCompareApiNotReady };
