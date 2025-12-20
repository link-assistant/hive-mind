/**
 * Repository setup functionality for solve.mjs
 * Handles repository cloning, forking, and remote setup
 */

export async function setupRepositoryAndClone({
  argv,
  owner,
  repo,
  forkOwner,
  tempDir,
  isContinueMode,
  issueUrl,
  log,
  $
}) {
  // Set up repository and handle forking
  const { repoToClone, forkedRepo, upstreamRemote, prForkOwner } = await setupRepository(argv, owner, repo, forkOwner, issueUrl);

  // Clone repository and set up remotes
  await cloneRepository(repoToClone, tempDir, argv, owner, repo);
  // Set up upstream remote and sync fork if needed
  await setupUpstreamAndSync(tempDir, forkedRepo, upstreamRemote, owner, repo, argv);
  // Set up pr-fork remote if we're continuing someone else's fork PR with --fork flag
  const prForkRemote = await setupPrForkRemote(tempDir, argv, prForkOwner, repo, isContinueMode, owner);

  // Set up git authentication using gh
  const authSetupResult = await $({ cwd: tempDir })`gh auth setup-git 2>&1`;
  if (authSetupResult.code !== 0) {
    await log('Note: gh auth setup-git had issues, continuing anyway\n');
  }

  return { repoToClone, forkedRepo, upstreamRemote, prForkRemote, prForkOwner };
}

async function setupRepository(argv, owner, repo, forkOwner, issueUrl) {
  const repository = await import('./solve.repository.lib.mjs');
  const { setupRepository: setupRepoFn } = repository;
  return await setupRepoFn(argv, owner, repo, forkOwner, issueUrl);
}

async function cloneRepository(repoToClone, tempDir, argv, owner, repo) {
  const repository = await import('./solve.repository.lib.mjs');
  const { cloneRepository: cloneRepoFn } = repository;
  return await cloneRepoFn(repoToClone, tempDir, argv, owner, repo);
}

async function setupUpstreamAndSync(tempDir, forkedRepo, upstreamRemote, owner, repo, argv) {
  const repository = await import('./solve.repository.lib.mjs');
  const { setupUpstreamAndSync: setupUpstreamFn } = repository;
  return await setupUpstreamFn(tempDir, forkedRepo, upstreamRemote, owner, repo, argv);
}

async function setupPrForkRemote(tempDir, argv, prForkOwner, repo, isContinueMode, owner) {
  const repository = await import('./solve.repository.lib.mjs');
  const { setupPrForkRemote: setupPrForkFn } = repository;
  return await setupPrForkFn(tempDir, argv, prForkOwner, repo, isContinueMode, owner);
}

export async function verifyDefaultBranchAndStatus({
  tempDir,
  log,
  formatAligned,
  $
}) {
  // Verify we're on the default branch and get its name
  const defaultBranchResult = await $({ cwd: tempDir })`git branch --show-current`;

  if (defaultBranchResult.code !== 0) {
    await log('Error: Failed to get current branch');
    await log(defaultBranchResult.stderr ? defaultBranchResult.stderr.toString() : 'Unknown error');
    throw new Error('Failed to get current branch');
  }

  const defaultBranch = defaultBranchResult.stdout.toString().trim();
  if (!defaultBranch) {
    await log('');
    await log(`${formatAligned('❌', 'DEFAULT BRANCH DETECTION FAILED', '')}`, { level: 'error' });
    await log('');
    await log('  🔍 What happened:');
    await log('     Unable to determine the repository\'s default branch.');
    await log('');
    await log('  💡 This might mean:');
    await log('     • Repository is empty (no commits)');
    await log('     • Unusual repository configuration');
    await log('     • Git command issues');
    await log('');
    await log('  🔧 How to fix:');
    await log('     1. Check repository status');
    await log(`     2. Verify locally: cd ${tempDir} && git branch`);
    await log(`     3. Check remote: cd ${tempDir} && git branch -r`);
    await log('');
    throw new Error('Default branch detection failed');
  }
  await log(`\n${formatAligned('📌', 'Default branch:', defaultBranch)}`);

  // Ensure we're on a clean default branch
  const statusResult = await $({ cwd: tempDir })`git status --porcelain`;
  if (statusResult.code !== 0) {
    await log('Error: Failed to check git status');
    await log(statusResult.stderr ? statusResult.stderr.toString() : 'Unknown error');
    throw new Error('Failed to check git status');
  }

  // Note: Empty output means clean working directory
  const statusOutput = statusResult.stdout.toString().trim();
  if (statusOutput) {
    await log('Error: Repository has uncommitted changes after clone');
    await log(`Status output: ${statusOutput}`);
    throw new Error('Repository has uncommitted changes after clone');
  }

  return defaultBranch;
}