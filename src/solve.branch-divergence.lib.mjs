const toCount = value => {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const outputOf = result => {
  const stdout = result?.stdout ? result.stdout.toString().trim() : '';
  const stderr = result?.stderr ? result.stderr.toString().trim() : '';
  return stdout || stderr;
};

const shortSha = sha => (sha ? String(sha).slice(0, 12) : null);

const encodeRefForGitHubUrl = ref =>
  encodeURI(String(ref || ''))
    .replaceAll('#', '%23')
    .replaceAll('?', '%3F');

export function classifyPushRejection(errorOutput = '') {
  const normalized = String(errorOutput || '').toLowerCase();

  if (normalized.includes('cannot lock ref') && normalized.includes('reference already exists')) {
    return 'remote-ref-already-exists';
  }

  if (normalized.includes('non-fast-forward') || normalized.includes('not fast-forward') || normalized.includes('fetch first') || normalized.includes('stale info') || normalized.includes('tip of your current branch is behind') || normalized.includes('updates were rejected')) {
    return 'non-fast-forward';
  }

  if (normalized.includes('remote rejected') || normalized.includes('[remote rejected]')) {
    return 'remote-rejected';
  }

  if (normalized.includes('rejected') || normalized.includes('failed to push some refs')) {
    return 'rejected';
  }

  return 'unknown';
}

/**
 * Detect whether a push failure was caused by missing permissions rather than
 * by branch divergence. Git surfaces this as `! [remote rejected] ...
 * (permission denied)` (HTTP 403). This is fundamentally different from a
 * non-fast-forward / divergence rejection: force-pushing or force-with-lease
 * will NOT help because the user simply cannot write to the remote.
 *
 * Issue #1893: when continuing another contributor's fork PR, the maintainer
 * does not own the fork, so pushing the fork's default branch is rejected with
 * "permission denied". The old heuristic matched the substring "rejected" and
 * misclassified this as fork divergence, halting the run and recommending a
 * useless `--allow-fork-divergence-resolution-using-force-push-with-lease`.
 */
export function isPermissionDeniedPushError(errorOutput = '') {
  const normalized = String(errorOutput || '').toLowerCase();
  return normalized.includes('permission denied') || normalized.includes('permission to') || normalized.includes('error: 403') || normalized.includes('the requested url returned error: 403') || (normalized.includes('denied') && normalized.includes('to https://'));
}

/**
 * Decide whether the solver should push the freshly-synced default branch to
 * the fork's `origin` remote.
 *
 * We only push the default branch to keep a fork we OWN in sync with upstream.
 * When continuing someone else's fork PR (the fork belongs to the contributor,
 * not the current user), the maintainer has push rights only to the PR branch
 * (via "Allow edits by maintainers"), never to the fork's default branch.
 * Attempting the push is both impossible (permission denied) and unnecessary,
 * so we skip it. Issue #1893.
 *
 * @param {object} params
 * @param {string|null} params.currentUser - authenticated GitHub login
 * @param {string|null} params.forkedRepo - "owner/name" of the fork (origin)
 * @returns {{ shouldPush: boolean, reason: string, forkOwner: string|null }}
 */
export function shouldPushDefaultBranchToFork({ currentUser, forkedRepo } = {}) {
  const forkOwner = forkedRepo && forkedRepo.includes('/') ? forkedRepo.split('/')[0] : null;

  if (!forkOwner) {
    // Without a parseable fork owner we cannot prove ownership; fall back to the
    // historical behaviour of attempting the push so nothing regresses.
    return { shouldPush: true, reason: 'fork-owner-unknown', forkOwner: null };
  }

  if (!currentUser) {
    // Could not resolve the current user; attempt the push and let git report.
    return { shouldPush: true, reason: 'current-user-unknown', forkOwner };
  }

  if (currentUser.toLowerCase() === forkOwner.toLowerCase()) {
    return { shouldPush: true, reason: 'owns-fork', forkOwner };
  }

  return { shouldPush: false, reason: 'not-fork-owner', forkOwner };
}

export function shouldTreatPushRejectionAsRemoteSynchronized(divergence = null) {
  if (!divergence?.remoteExists || divergence.ahead !== 0 || divergence.behind !== 0) {
    return false;
  }

  if (divergence.localSha && divergence.remoteSha) {
    return divergence.localSha === divergence.remoteSha;
  }

  return true;
}

export function buildBranchSubjectLinks({ owner, repo, branchName, defaultBranch, forkedRepo = null }) {
  const repository = `${owner}/${repo}`;
  const headRepository = forkedRepo || repository;
  const headOwner = headRepository.split('/')[0];
  const baseBranch = defaultBranch || 'main';
  const compareHead = forkedRepo ? `${headOwner}:${branchName}` : branchName;

  return {
    repository,
    headRepository,
    baseBranchRef: `${repository}:${baseBranch}`,
    headBranchRef: `${headRepository}:${branchName}`,
    remoteBranchRef: `origin/${branchName}`,
    repositoryUrl: `https://github.com/${repository}`,
    branchUrl: `https://github.com/${headRepository}/tree/${encodeRefForGitHubUrl(branchName)}`,
    compareUrl: `https://github.com/${repository}/compare/${encodeRefForGitHubUrl(baseBranch)}...${encodeRefForGitHubUrl(compareHead)}`,
  };
}

export function buildPushRejectionFailureActionSection({ owner, repo, branchName, defaultBranch, forkedRepo = null }) {
  if (!owner || !repo || !branchName) {
    return `### What you can do
- Inspect the remote branch and compare it with the local branch before retrying.
- If the remote branch already contains the intended commit, rerun the solver.
- If the histories differ, merge or resolve the branch manually, then rerun the solver.`;
  }

  const links = buildBranchSubjectLinks({ owner, repo, branchName, defaultBranch, forkedRepo });

  return `### What you can do
- Inspect the remote branch: ${links.branchUrl}
- Compare the base and head branches: ${links.compareUrl}
- If the remote branch already contains the intended commit, rerun the solver. Matching remote branches are treated as usable after this fix.
- If the histories differ, merge or resolve \`${links.headBranchRef}\` against \`${links.baseBranchRef}\`, then rerun the solver.

Administrator-only CLI details, if any, are printed in the solver terminal log rather than in this GitHub comment.`;
}

export function buildPushRejectionExplanation({ branchName, isContinueMode, prNumber, divergence = null, owner = null, repo = null, defaultBranch = null, forkedRepo = null, classification = 'unknown' }) {
  const lines = [];

  if (isContinueMode && !prNumber) {
    lines.push('     This run reused an existing issue branch because auto-continue found a matching branch with no PR.');
    lines.push('     It is not a fresh branch created by this run, even though auto-PR creation is running now.');
  } else if (classification === 'remote-ref-already-exists') {
    lines.push('     GitHub rejected the push while creating or updating the remote ref because that ref already exists.');
  } else {
    lines.push('     The remote branch changed after the local branch state used for this push.');
  }

  if (owner && repo) {
    const links = buildBranchSubjectLinks({ owner, repo, branchName, defaultBranch, forkedRepo });
    lines.push(`     Repository: ${links.repositoryUrl}`);
    lines.push(`     Base branch: ${links.baseBranchRef}`);
    lines.push(`     Remote branch: ${links.headBranchRef}`);
    lines.push(`     Branch URL: ${links.branchUrl}`);
    lines.push(`     Compare URL: ${links.compareUrl}`);
  }

  if (divergence?.remoteExists && divergence.ahead !== null && divergence.behind !== null) {
    lines.push(`     Current branch state for ${branchName}: ${divergence.ahead} commit(s) ahead, ${divergence.behind} commit(s) behind origin/${branchName}.`);
    if (divergence.localSha) {
      lines.push(`     Local HEAD: ${shortSha(divergence.localSha)}`);
    }
    if (divergence.remoteSha) {
      lines.push(`     Remote HEAD: ${shortSha(divergence.remoteSha)}`);
    }
    if (shouldTreatPushRejectionAsRemoteSynchronized(divergence)) {
      lines.push('     The remote branch currently matches local HEAD, so this is not a branch divergence.');
    }
  } else if (divergence?.fetchError) {
    lines.push(`     Could not inspect origin/${branchName}: ${divergence.fetchError}`);
  }

  return lines;
}

export async function logRecoverablePushRejection({ log, formatAligned, branchName, isContinueMode, prNumber, divergence, owner, repo, defaultBranch, forkedRepo, classification }) {
  const links = buildBranchSubjectLinks({ owner, repo, branchName, defaultBranch, forkedRepo });

  await log('');
  await log(formatAligned('⚠️', 'PUSH REPORTED FAILURE:', 'Remote branch already matches local HEAD'), { level: 'warning' });
  await log('');
  await log('  🔍 What happened:');
  for (const line of buildPushRejectionExplanation({
    branchName,
    isContinueMode,
    prNumber,
    divergence,
    owner,
    repo,
    defaultBranch,
    forkedRepo,
    classification,
  })) {
    await log(line);
  }
  await log('');
  await log('  ✅ Recovery:');
  await log(`     The branch is available at ${links.branchUrl}.`);
  await log('     Continuing with PR creation because no local commit would be lost.');
  await log('');

  return links;
}

export async function logBlockingPushRejection({ log, formatAligned, branchName, isContinueMode, prNumber, divergence, owner, repo, defaultBranch, forkedRepo, classification }) {
  const links = buildBranchSubjectLinks({ owner, repo, branchName, defaultBranch, forkedRepo });
  const isRefCollision = classification === 'remote-ref-already-exists';

  await log('');
  await log(formatAligned('❌', isRefCollision ? 'REMOTE BRANCH COLLISION:' : 'PUSH REJECTED:', isRefCollision ? 'Remote ref already exists and differs from local branch' : 'Local and remote branch histories differ'), { level: 'error' });
  await log('');
  await log('  🔍 What happened:');
  if (isRefCollision) {
    await log(`     GitHub rejected creation or update of ${links.headBranchRef} because that remote ref already exists.`);
    await log('     The existing remote branch does not match this local branch, so hive-mind cannot assume it is safe to continue.');
  } else {
    await log(`     Git rejected updating ${links.headBranchRef} from this local branch.`);
    await log('     The local and remote histories are not in a state that a normal push can update safely.');
  }
  for (const line of buildPushRejectionExplanation({
    branchName,
    isContinueMode,
    prNumber,
    divergence,
    owner,
    repo,
    defaultBranch,
    forkedRepo,
    classification,
  })) {
    await log(line);
  }
  await log('');
  await log('  💡 Why we cannot fix this automatically:');
  await log('     • We never use force push to preserve history');
  await log('     • We never use rebase or reset to avoid altering git history');
  await log(`     • Manual review is required before changing ${links.headBranchRef}`);
  await log('');
  await log('  🔧 How to fix:');
  await log(`     1. Inspect the remote branch: ${links.branchUrl}`);
  await log(`     2. Compare base and head: ${links.compareUrl}`);
  await log('     3. Clone the repository and checkout the branch:');
  await log(`        git clone https://github.com/${links.headRepository}.git`);
  await log(`        cd ${links.headRepository.split('/')[1]}`);
  await log(`        git checkout ${branchName}`);
  await log('');
  await log('     4. Merge the remote branch state, resolve conflicts if any, then push:');
  await log(`        git pull origin ${branchName}`);
  await log(`        git push origin ${branchName}`);
  await log('');
  await log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  await log('');

  return {
    links,
    failureActionSection: buildPushRejectionFailureActionSection({ owner, repo, branchName, defaultBranch, forkedRepo }),
  };
}

export async function handleRejectedPushForAutoPr({ errorOutput, $, tempDir, log, formatAligned, branchName, isContinueMode, prNumber, owner, repo, defaultBranch, forkedRepo }) {
  const classification = classifyPushRejection(errorOutput);
  if (classification === 'unknown') {
    return {
      handled: false,
      branchReadyForPrCreation: false,
      recoveredFromPushRejection: false,
    };
  }

  const divergence = await getRemoteBranchDivergenceSnapshot({ $, tempDir, branchName });

  if (shouldTreatPushRejectionAsRemoteSynchronized(divergence)) {
    await logRecoverablePushRejection({
      log,
      formatAligned,
      branchName,
      isContinueMode,
      prNumber,
      divergence,
      owner,
      repo,
      defaultBranch,
      forkedRepo,
      classification,
    });
    return {
      handled: true,
      branchReadyForPrCreation: true,
      recoveredFromPushRejection: true,
    };
  }

  const { links, failureActionSection } = await logBlockingPushRejection({
    log,
    formatAligned,
    branchName,
    isContinueMode,
    prNumber,
    divergence,
    owner,
    repo,
    defaultBranch,
    forkedRepo,
    classification,
  });
  const error = new Error(`Push rejected for ${links.headBranchRef}; compare ${links.compareUrl} and inspect ${links.branchUrl}`);
  error.hiveMindUserFacingLogged = true;
  error.failureActionSection = failureActionSection;
  throw error;
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
  const localShaResult = await $({ cwd: tempDir, silent: true })`git rev-parse HEAD 2>&1`;
  const remoteShaResult = await $({ cwd: tempDir, silent: true })`git rev-parse origin/${branchName} 2>&1`;

  return {
    remoteExists: aheadResult.code === 0 && behindResult.code === 0,
    ahead: aheadResult.code === 0 ? toCount(aheadResult.stdout) : null,
    behind: behindResult.code === 0 ? toCount(behindResult.stdout) : null,
    localSha: localShaResult.code === 0 ? outputOf(localShaResult) : null,
    remoteSha: remoteShaResult.code === 0 ? outputOf(remoteShaResult) : null,
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
