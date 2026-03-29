/**
 * Repository setup functionality for solve.mjs
 * Handles repository cloning, forking, and remote setup
 */

export async function setupRepositoryAndClone({ argv, owner, repo, forkOwner, forkRepoName, tempDir, isContinueMode, issueUrl, log, $, needsClone = true }) {
  // Set up repository and handle forking
  const { repoToClone, forkedRepo, upstreamRemote, prForkOwner } = await setupRepository(argv, owner, repo, forkOwner, issueUrl, forkRepoName);

  // Clone repository and set up remotes (skip if needsClone is false - directory already has repo)
  if (needsClone) {
    await cloneRepository(repoToClone, tempDir, argv, owner, repo);
    // Set up upstream remote and sync fork if needed
    await setupUpstreamAndSync(tempDir, forkedRepo, upstreamRemote, owner, repo, argv);
  } else {
    await log('ℹ️  Skipping clone: Using existing repository in working directory');
    // Still need to ensure upstream remote is set up if using fork mode
    if (forkedRepo && upstreamRemote) {
      await setupUpstreamAndSync(tempDir, forkedRepo, upstreamRemote, owner, repo, argv);
    }
  }

  // Set up pr-fork remote if we're continuing someone else's fork PR with --fork flag
  const prForkRemote = await setupPrForkRemote(tempDir, argv, prForkOwner, repo, isContinueMode, owner);

  // Set up git authentication using gh
  const authSetupResult = await $({ cwd: tempDir })`gh auth setup-git 2>&1`;
  if (authSetupResult.code !== 0) {
    await log('Note: gh auth setup-git had issues, continuing anyway\n');
  }

  return { repoToClone, forkedRepo, upstreamRemote, prForkRemote, prForkOwner };
}

async function setupRepository(argv, owner, repo, forkOwner, issueUrl, forkRepoName) {
  const repository = await import('./solve.repository.lib.mjs');
  const { setupRepository: setupRepoFn } = repository;
  return await setupRepoFn(argv, owner, repo, forkOwner, issueUrl, forkRepoName);
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

export async function verifyDefaultBranchAndStatus({ tempDir, log, formatAligned, $, argv, owner, repo, issueUrl }) {
  // Verify we're on the default branch and get its name
  const defaultBranchResult = await $({ cwd: tempDir })`git branch --show-current`;

  if (defaultBranchResult.code !== 0) {
    await log('Error: Failed to get current branch');
    await log(defaultBranchResult.stderr ? defaultBranchResult.stderr.toString() : 'Unknown error');
    throw new Error('Failed to get current branch');
  }

  let defaultBranch = defaultBranchResult.stdout.toString().trim();
  if (!defaultBranch) {
    // Repository is likely empty (no commits) - detect and handle
    const isEmptyRepo = await detectEmptyRepository(tempDir, $);

    if (isEmptyRepo && argv && argv.autoInitRepository && owner && repo) {
      // --auto-init-repository is enabled, try to initialize
      await log('');
      await log(`${formatAligned('⚠️', 'EMPTY REPOSITORY', 'detected')}`, { level: 'warn' });
      await log(`${formatAligned('', '', `Repository ${owner}/${repo} contains no commits`)}`);
      await log(`${formatAligned('', '', '--auto-init-repository is enabled, attempting initialization...')}`);
      await log('');

      const repository = await import('./solve.repository.lib.mjs');
      const { tryInitializeEmptyRepository } = repository;
      const initialized = await tryInitializeEmptyRepository(owner, repo);

      if (initialized) {
        await log('');
        await log(`${formatAligned('🔄', 'Re-fetching:', 'Pulling initialized repository...')}`);
        // Wait for GitHub to process the new file
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Re-fetch the origin to get the new commit
        const fetchResult = await $({ cwd: tempDir })`git fetch origin`;
        if (fetchResult.code !== 0) {
          await log(`${formatAligned('❌', 'Fetch failed:', 'Could not fetch after initialization')}`, { level: 'error' });
          throw new Error('Failed to fetch after empty repository initialization');
        }

        // Determine default branch name from the remote
        const remoteHeadResult = await $({ cwd: tempDir })`git remote show origin`;
        let remoteBranch = 'main'; // default fallback
        if (remoteHeadResult.code === 0) {
          const remoteOutput = remoteHeadResult.stdout.toString();
          const headMatch = remoteOutput.match(/HEAD branch:\s*(\S+)/);
          if (headMatch) {
            remoteBranch = headMatch[1];
          }
        }

        // Checkout the remote branch locally
        const checkoutResult = await $({ cwd: tempDir })`git checkout -b ${remoteBranch} origin/${remoteBranch}`;
        if (checkoutResult.code !== 0) {
          // Try alternative: maybe the branch already exists locally somehow
          const altResult = await $({ cwd: tempDir })`git checkout ${remoteBranch}`;
          if (altResult.code !== 0) {
            await log(`${formatAligned('❌', 'Checkout failed:', `Could not checkout ${remoteBranch} after initialization`)}`, { level: 'error' });
            throw new Error('Failed to checkout branch after empty repository initialization');
          }
        }

        defaultBranch = remoteBranch;
        await log(`${formatAligned('✅', 'Repository initialized:', `Now on branch ${defaultBranch}`)}`);
        await log(`\n${formatAligned('📌', 'Default branch:', defaultBranch)}`);
      } else {
        // Auto-init failed - provide helpful message with --auto-init-repository context
        await log('');
        await log(`${formatAligned('❌', 'AUTO-INIT FAILED', '')}`, { level: 'error' });
        await log('');
        await log('  🔍 What happened:');
        await log(`     Repository ${owner}/${repo} is empty (no commits).`);
        await log('     --auto-init-repository was enabled but initialization failed.');
        await log('     You may not have write access to create files in the repository.');
        await log('');
        await log('  💡 How to fix:');
        await log('     Option 1: Ask repository owner to add initial content');
        await log('              Even a simple README.md file would allow branch creation');
        await log('');
        await log(`     Option 2: Manually initialize: gh api repos/${owner}/${repo}/contents/README.md \\`);
        await log('                --method PUT --field message="Initialize repository" \\');
        await log('                --field content="$(echo "# repo" | base64)"');
        await log('');

        // Post a comment on the issue informing about the empty repository
        await tryCommentOnIssueAboutEmptyRepo({ issueUrl, owner, repo, log, formatAligned, $ });

        throw new Error('Empty repository auto-initialization failed');
      }
    } else if (isEmptyRepo) {
      // Empty repo detected but --auto-init-repository is not enabled
      await log('');
      await log(`${formatAligned('❌', 'EMPTY REPOSITORY DETECTED', '')}`, { level: 'error' });
      await log('');
      await log('  🔍 What happened:');
      await log(`     The repository${owner && repo ? ` ${owner}/${repo}` : ''} is empty (no commits).`);
      await log('     Cannot create branches or pull requests on an empty repository.');
      await log('');
      await log('  💡 How to fix:');
      await log('     Option 1: Use --auto-init-repository flag to automatically create a README.md');
      await log(`              solve <issue-url> --auto-init-repository`);
      await log('');
      await log('     Option 2: Ask repository owner to add initial content');
      await log('              Even a simple README.md file would allow branch creation');
      await log('');

      // Post a comment on the issue informing about the empty repository
      await tryCommentOnIssueAboutEmptyRepo({ issueUrl, owner, repo, log, formatAligned, $ });

      throw new Error('Empty repository detected - use --auto-init-repository to initialize');
    } else {
      // Not an empty repo, some other issue with branch detection
      await log('');
      await log(`${formatAligned('❌', 'DEFAULT BRANCH DETECTION FAILED', '')}`, { level: 'error' });
      await log('');
      await log('  🔍 What happened:');
      await log("     Unable to determine the repository's default branch.");
      await log('');
      await log('  💡 This might mean:');
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
  } else {
    await log(`\n${formatAligned('📌', 'Default branch:', defaultBranch)}`);
  }

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

/**
 * Try to post a comment on the issue informing the user about the empty repository.
 * This is a non-critical operation - errors are silently ignored.
 * When --auto-init-repository succeeds, no comment is posted (no action needed from the user).
 */
async function tryCommentOnIssueAboutEmptyRepo({ issueUrl, owner, repo, log, formatAligned, $ }) {
  if (!issueUrl) return;

  try {
    const issueMatch = issueUrl.match(/\/issues\/(\d+)/);
    if (!issueMatch) return;

    const issueNumber = issueMatch[1];
    await log(`${formatAligned('💬', 'Creating comment:', 'Informing about empty repository...')}`);

    const commentBody = `## ⚠️ Repository Initialization Required

Hello! I attempted to work on this issue, but encountered a problem:

**Issue**: The repository is empty (no commits) and branches cannot be created.
**Reason**: Git cannot create branches in a repository with no commits.

### 🔧 How to resolve:

**Option 1: Use \`--auto-init-repository\` flag**
Re-run the solver with the \`--auto-init-repository\` flag to automatically create a simple README.md:
\`\`\`
solve ${issueUrl} --auto-init-repository
\`\`\`

**Option 2: Initialize the repository yourself**
Please add initial content to the repository. Even a simple README.md (even if it is empty or contains just the title) file would make it possible to create branches and work on this issue.

Once the repository contains at least one commit with any file, I'll be able to proceed with solving this issue.

Thank you!`;

    const commentResult = await $`gh issue comment ${issueNumber} --repo ${owner}/${repo} --body ${commentBody}`;
    if (commentResult.code === 0) {
      await log(`${formatAligned('✅', 'Comment created:', `Posted to issue #${issueNumber}`)}`);
    } else {
      await log(`${formatAligned('⚠️', 'Note:', 'Could not post comment to issue (this is not critical)')}`);
    }
  } catch {
    // Silently ignore comment creation errors - not critical to the process
    await log(`${formatAligned('⚠️', 'Note:', 'Could not post comment to issue (this is not critical)')}`);
  }
}

/**
 * Detect if a cloned repository is empty (has no commits).
 * An empty repository has no branches and no commits.
 */
async function detectEmptyRepository(tempDir, $) {
  // Check if there are any commits in the repository
  const logResult = await $({ cwd: tempDir })`git rev-parse HEAD 2>&1`;
  if (logResult.code !== 0) {
    // git rev-parse HEAD fails when there are no commits
    const output = (logResult.stdout || logResult.stderr || '').toString();
    if (output.includes('unknown revision') || output.includes('bad default revision') || output.includes('does not have any commits')) {
      return true;
    }
  }

  // Also check if there are any remote branches
  const remoteBranchResult = await $({ cwd: tempDir })`git branch -r`;
  if (remoteBranchResult.code === 0) {
    const branches = remoteBranchResult.stdout.toString().trim();
    if (!branches) {
      return true;
    }
  }

  return false;
}
