const toCount = value => {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const outputOf = result => {
  const stdout = result?.stdout ? result.stdout.toString().trim() : '';
  const stderr = result?.stderr ? result.stderr.toString().trim() : '';
  return stdout || stderr;
};

export function buildPushRejectionExplanation({ branchName, isContinueMode, prNumber, divergence = null }) {
  const lines = [];

  if (isContinueMode && !prNumber) {
    lines.push('     This run reused an existing issue branch because auto-continue found a matching branch with no PR.');
    lines.push('     It is not a fresh branch created by this run, even though auto-PR creation is running now.');
  } else {
    lines.push('     The remote branch changed after the local branch state used for this push.');
  }

  if (divergence?.remoteExists && divergence.ahead !== null && divergence.behind !== null) {
    lines.push(`     Current branch state for ${branchName}: ${divergence.ahead} commit(s) ahead, ${divergence.behind} commit(s) behind origin/${branchName}.`);
  } else if (divergence?.fetchError) {
    lines.push(`     Could not inspect origin/${branchName}: ${divergence.fetchError}`);
  }

  return lines;
}

export async function getRemoteBranchDivergenceSnapshot({ $, tempDir, branchName }) {
  const fetchResult = await $({ cwd: tempDir, silent: true })`git fetch origin refs/heads/${branchName}:refs/remotes/origin/${branchName} 2>&1`;
  if (fetchResult.code !== 0) {
    return {
      remoteExists: false,
      ahead: null,
      behind: null,
      fetchError: outputOf(fetchResult) || 'remote branch not found',
    };
  }

  const aheadResult = await $({ cwd: tempDir, silent: true })`git rev-list --count origin/${branchName}..HEAD 2>&1`;
  const behindResult = await $({ cwd: tempDir, silent: true })`git rev-list --count HEAD..origin/${branchName} 2>&1`;

  return {
    remoteExists: aheadResult.code === 0 && behindResult.code === 0,
    ahead: aheadResult.code === 0 ? toCount(aheadResult.stdout) : null,
    behind: behindResult.code === 0 ? toCount(behindResult.stdout) : null,
    fetchError: aheadResult.code === 0 && behindResult.code === 0 ? null : outputOf(aheadResult) || outputOf(behindResult) || 'could not compare local and remote branch',
  };
}

export async function synchronizeExistingIssueBranchBeforeAutoPrCreation({ tempDir, branchName, isContinueMode, prNumber, log, formatAligned, $ }) {
  if (!(isContinueMode && !prNumber)) {
    return null;
  }

  await log(formatAligned('🔎', 'Existing branch sync:', branchName));
  const divergence = await getRemoteBranchDivergenceSnapshot({ $, tempDir, branchName });
  if (!divergence.remoteExists) {
    await log(`   ⚠️ Could not inspect origin/${branchName}: ${divergence.fetchError || 'unknown error'}`, { level: 'warning' });
    return divergence;
  }

  await log(`   Branch state before PR bootstrap commit: ${divergence.ahead} commit(s) ahead, ${divergence.behind} commit(s) behind origin/${branchName}`);

  if (divergence.behind > 0 && divergence.ahead === 0) {
    await log(`   Fast-forwarding ${branchName} to origin/${branchName} before creating the PR bootstrap commit...`);
    const mergeResult = await $({ cwd: tempDir })`git merge --ff-only origin/${branchName} 2>&1`;
    if (mergeResult.code !== 0) {
      await log(`   ⚠️ Fast-forward failed: ${outputOf(mergeResult) || 'unknown error'}`, {
        level: 'warning',
      });
      throw new Error('Existing issue branch could not be fast-forwarded before PR creation');
    }
    await log(`   ✅ Branch fast-forwarded to origin/${branchName}`);
    return await getRemoteBranchDivergenceSnapshot({ $, tempDir, branchName });
  }

  if (divergence.behind > 0 && divergence.ahead > 0) {
    for (const line of buildPushRejectionExplanation({
      branchName,
      isContinueMode,
      prNumber,
      divergence,
    })) {
      await log(line);
    }
    throw new Error('Existing issue branch has diverged before PR creation; manual resolution required');
  }

  return divergence;
}
