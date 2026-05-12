/**
 * Fork-aware diagnostic for the auto-PR fatal error block.
 *
 * Issue #1774: when `gh pr create` fails with "No commits between" or
 * "Head sha can't be blank", the most common cause is base-repo resolution
 * picking the upstream parent of a fork (because `gh repo clone` auto-adds
 * an `upstream` remote for forks). This helper inspects the local remotes
 * and prints a self-explanatory diagnostic.
 *
 * Extracted from solve.auto-pr.lib.mjs to keep that file under the 1500-line
 * CI cap.
 */

/**
 * @param {object} params
 * @param {string} params.errorMessage - prError.message from the auto-PR catch.
 * @param {string} params.tempDir
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string} params.defaultBranch
 * @param {string} params.branchName
 * @param {string|number} params.issueNumber
 * @param {(msg: string, opts?: object) => Promise<void>} params.log
 * @param {Function} params.$ - command-stream tagged function from solve.
 * @param {Function} params.reportError
 */
export async function emitForkAwareDiagnostic({ errorMessage, tempDir, owner, repo, defaultBranch, branchName, issueNumber, log, $, reportError }) {
  const errMsg = errorMessage || '';
  if (!errMsg.includes('No commits between') && !errMsg.includes("Head sha can't be blank")) {
    return;
  }

  try {
    const remotesResult = await $({ cwd: tempDir, silent: true })`git remote -v`;
    const remotesText = remotesResult.code === 0 ? remotesResult.stdout.toString().trim() : '';
    const originLine = remotesText.split('\n').find(line => line.startsWith('origin\t') && line.includes('(fetch)'));
    const upstreamLine = remotesText.split('\n').find(line => line.startsWith('upstream\t') && line.includes('(fetch)'));

    await log('  🔬 Fork-aware diagnostic (Issue #1774):');
    await log(`     Target repository:      ${owner}/${repo}`);
    if (originLine) {
      await log(`     origin remote:          ${originLine.replace(/^origin\t/, '').replace(/\s+\(fetch\)$/, '')}`);
    }
    if (upstreamLine) {
      await log(`     upstream remote:        ${upstreamLine.replace(/^upstream\t/, '').replace(/\s+\(fetch\)$/, '')}`);
      await log('');
      await log('     `gh repo clone` automatically adds an `upstream` remote when the');
      await log('     cloned repository is a fork. Without --repo, `gh pr create`');
      await log('     resolves the base to that upstream parent instead of the fork');
      await log('     where this branch was pushed, producing the misleading');
      await log('     "No commits between" error. This version already pins --repo');
      await log('     to the explicit target, so a fresh `solve` invocation should');
      await log('     succeed. See docs/case-studies/issue-1774/README.md.');
    } else {
      await log('     (no `upstream` remote found locally)');
    }
    await log('');
    await log('     Manual recovery command:');
    await log(`     gh pr create --draft --base ${defaultBranch} --head ${branchName} --repo ${owner}/${repo}`);
    await log('');
  } catch (diagError) {
    reportError(diagError, {
      context: 'auto_pr_fork_diagnostic',
      issueNumber,
      operation: 'collect_fork_diagnostic',
    });
  }
}

export default { emitForkAwareDiagnostic };
